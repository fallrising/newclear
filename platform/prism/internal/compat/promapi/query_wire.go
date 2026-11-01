package promapi

import (
	"errors"
	"strings"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/promql/parser"
)

type queryData struct {
	ResultType string `json:"resultType"`
	Result     any    `json:"result"`
}
type vectorWire struct {
	Metric map[string]string `json:"metric"`
	Value  [2]any            `json:"value"`
}
type matrixWire struct {
	Metric map[string]string `json:"metric"`
	Values [][2]any          `json:"values"`
}

func sampleWire(ts int64, value float64) [2]any {
	return [2]any{utm.MilliToSecFloat(ts), utm.FormatPromValue(value)}
}
func labelsWire(input labels.Labels) (map[string]string, error) {
	if input.Len() > 128 {
		return nil, qerr(spi.ErrTooLarge)
	}
	if labelByteSize(input) > 1<<20 {
		return nil, qerr(spi.ErrTooLarge)
	}
	result := make(map[string]string, input.Len())
	input.Range(func(l labels.Label) {
		if !reservedQueryLabel(l.Name) {
			result[strings.Clone(l.Name)] = strings.Clone(l.Value)
		}
	})
	return result, nil
}
func labelByteSize(input labels.Labels) int {
	bytes := 0
	input.Range(func(l labels.Label) { bytes += len(l.Name) + len(l.Value) })
	return bytes
}
func wireNative(result *spi.PromResult, limit int) (any, []string, error) {
	if result == nil {
		return nil, nil, qerr(spi.ErrInternal)
	}
	if len(result.Warnings) > maxQueryWarnings {
		return nil, nil, qerr(spi.ErrTooLarge)
	}
	warningBytes := 0
	for _, s := range result.Warnings {
		warningBytes += len(s)
		if len(s) > 4096 || warningBytes > 16384 {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
	}
	var warnings []string
	if len(result.Warnings) > 0 {
		warnings = append(warnings, "query completed with backend warnings")
	}
	switch result.ResultType {
	case "vector":
		if len(result.Vector) > maxQueryResult {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		take := len(result.Vector)
		if limit > 0 && take > limit {
			take = limit
			warnings = append(warnings, "results truncated to requested limit")
		}
		output := make([]vectorWire, 0, take)
		cost := 0
		for i, s := range result.Vector {
			metric, err := labelsWire(s.Labels)
			if err != nil {
				return nil, nil, err
			}
			cost += labelByteSize(s.Labels) + 64
			if cost > maxQueryMetadata {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if i < take {
				output = append(output, vectorWire{metric, sampleWire(s.TS, s.Value)})
			}
		}
		return queryData{"vector", output}, warnings, nil
	case "matrix":
		if len(result.Matrix) > maxQueryResult {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		take := len(result.Matrix)
		if limit > 0 && take > limit {
			take = limit
			warnings = append(warnings, "results truncated to requested limit")
		}
		output := make([]matrixWire, 0, take)
		cost := 0
		for i, s := range result.Matrix {
			metric, err := labelsWire(s.Labels)
			if err != nil {
				return nil, nil, err
			}
			if len(s.Samples) > (maxQueryMetadata-cost)/32 {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			cost += labelByteSize(s.Labels) + len(s.Samples)*32 + 64
			if cost > maxQueryMetadata {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if len(s.Samples) > maxQueryResult {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if i < take {
				values := make([][2]any, 0, len(s.Samples))
				for _, p := range s.Samples {
					wire := sampleWire(p.TS, p.Value)
					if len(wire[1].(string)) > (maxQueryResponse-cost)/6 {
						return nil, nil, qerr(spi.ErrTooLarge)
					}
					cost += len(wire[1].(string)) * 6
					values = append(values, wire)
				}
				output = append(output, matrixWire{metric, values})
			}
		}
		return queryData{"matrix", output}, warnings, nil
	case "scalar":
		if result.Scalar == nil {
			return nil, nil, qerr(spi.ErrInternal)
		}
		return queryData{"scalar", sampleWire(result.Scalar.TS, result.Scalar.Value)}, warnings, nil
	default:
		return nil, nil, qerr(spi.ErrInternal)
	}
}
func wirePromQL(value parser.Value, limit int) (any, []string, error) {
	if value == nil {
		return nil, nil, qerr(spi.ErrInternal)
	}
	var warnings []string
	switch v := value.(type) {
	case promql.Vector:
		if len(v) > maxQueryResult {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		take := len(v)
		if limit > 0 && take > limit {
			take = limit
			warnings = append(warnings, "results truncated to requested limit")
		}
		output := make([]vectorWire, 0, take)
		cost := 0
		for i, s := range v {
			if s.H != nil {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			metric, err := labelsWire(s.Metric)
			if err != nil {
				return nil, nil, err
			}
			cost += labelByteSize(s.Metric) + 64
			if cost > maxQueryMetadata {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if i < take {
				output = append(output, vectorWire{metric, sampleWire(s.T, s.F)})
			}
		}
		return queryData{"vector", output}, warnings, nil
	case promql.Matrix:
		if len(v) > maxQueryResult {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		take := len(v)
		if limit > 0 && take > limit {
			take = limit
			warnings = append(warnings, "results truncated to requested limit")
		}
		output := make([]matrixWire, 0, take)
		cost := 0
		for i, s := range v {
			if len(s.Histograms) > 0 || len(s.Floats) > maxQueryResult {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			metric, err := labelsWire(s.Metric)
			if err != nil {
				return nil, nil, err
			}
			if len(s.Floats) > (maxQueryMetadata-cost)/32 {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			cost += labelByteSize(s.Metric) + len(s.Floats)*32 + 64
			if cost > maxQueryMetadata {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if i < take {
				values := make([][2]any, 0, len(s.Floats))
				for _, p := range s.Floats {
					wire := sampleWire(p.T, p.F)
					if len(wire[1].(string)) > (maxQueryResponse-cost)/6 {
						return nil, nil, qerr(spi.ErrTooLarge)
					}
					cost += len(wire[1].(string)) * 6
					values = append(values, wire)
				}
				output = append(output, matrixWire{metric, values})
			}
		}
		return queryData{"matrix", output}, warnings, nil
	case promql.Scalar:
		return queryData{"scalar", sampleWire(v.T, v.V)}, warnings, nil
	case *promql.Scalar:
		return queryData{"scalar", sampleWire(v.T, v.V)}, warnings, nil
	case promql.String:
		return queryData{"string", [2]any{utm.MilliToSecFloat(v.T), v.V}}, warnings, nil
	case *promql.String:
		return queryData{"string", [2]any{utm.MilliToSecFloat(v.T), v.V}}, warnings, nil
	default:
		return nil, nil, errors.New("unsupported PromQL result")
	}
}

// preflightResponse bounds worst-case JSON escaping before the encoder owns a
// second copy of the response. JSON can expand one input byte to six bytes.
func preflightResponse(data any, warnings []string) error {
	remaining := maxQueryResponse - 512
	charge := func(s string) bool {
		if len(s) > (remaining-64)/6 {
			return false
		}
		remaining -= len(s)*6 + 64
		return remaining >= 0
	}
	for _, warning := range warnings {
		if !charge(warning) {
			return qerr(spi.ErrTooLarge)
		}
	}
	labelMap := func(m map[string]string) bool {
		for key, value := range m {
			if !charge(key) || !charge(value) {
				return false
			}
		}
		return true
	}
	switch d := data.(type) {
	case queryData:
		if !charge(d.ResultType) {
			return qerr(spi.ErrTooLarge)
		}
		switch items := d.Result.(type) {
		case []vectorWire:
			for _, item := range items {
				if !labelMap(item.Metric) || !charge(item.Value[1].(string)) {
					return qerr(spi.ErrTooLarge)
				}
				remaining -= 96
				if remaining < 0 {
					return qerr(spi.ErrTooLarge)
				}
			}
		case []matrixWire:
			for _, item := range items {
				if !labelMap(item.Metric) {
					return qerr(spi.ErrTooLarge)
				}
				for _, v := range item.Values {
					if !charge(v[1].(string)) {
						return qerr(spi.ErrTooLarge)
					}
					remaining -= 32
					if remaining < 0 {
						return qerr(spi.ErrTooLarge)
					}
				}
			}
		case [2]any:
			if !charge(items[1].(string)) {
				return qerr(spi.ErrTooLarge)
			}
		default:
			return qerr(spi.ErrInternal)
		}
	case []string:
		for _, s := range d {
			if !charge(s) {
				return qerr(spi.ErrTooLarge)
			}
		}
	case []map[string]string:
		for _, item := range d {
			if !labelMap(item) {
				return qerr(spi.ErrTooLarge)
			}
		}
	case map[string][]map[string]string:
		for key, items := range d {
			if !charge(key) {
				return qerr(spi.ErrTooLarge)
			}
			for _, item := range items {
				if !labelMap(item) {
					return qerr(spi.ErrTooLarge)
				}
			}
		}
	case map[string]string:
		if !labelMap(d) {
			return qerr(spi.ErrTooLarge)
		}
	default:
		return qerr(spi.ErrInternal)
	}
	return nil
}
