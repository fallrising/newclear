package promapi

import (
	"context"
	"unicode/utf8"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/prompb"
	"google.golang.org/protobuf/encoding/protowire"
)

const maxProtocolElements = 100_000

type writeSchema uint8

const (
	writeRequest writeSchema = iota
	timeSeries
	label
	sample
	exemplar
	histogram
	bucketSpan
	metadata
)

func decodeWrite(ctx context.Context, compressed []byte, limit int) (*prompb.WriteRequest, int64, error) {
	if err := ctx.Err(); err != nil {
		return nil, 0, spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
	}
	if len(compressed) > limit {
		return nil, 0, writeFailure(spi.ErrTooLarge)
	}
	decodedLen, err := snappy.DecodedLen(compressed)
	if err != nil {
		return nil, 0, writeFailure(spi.ErrBadRequest)
	}
	if decodedLen > limit {
		return nil, 0, writeFailure(spi.ErrTooLarge)
	}
	payload, err := snappy.Decode(nil, compressed)
	if err != nil {
		return nil, 0, writeFailure(spi.ErrBadRequest)
	}
	remaining := maxProtocolElements
	if err := validateWriteMessage(ctx, payload, writeRequest, &remaining); err != nil {
		return nil, 0, err
	}
	request := new(prompb.WriteRequest)
	if err := request.Unmarshal(payload); err != nil {
		return nil, 0, writeFailure(spi.ErrBadRequest)
	}
	if err := validateWriteSeries(ctx, request); err != nil {
		return nil, 0, err
	}
	return request, int64(len(payload)), nil
}

// All fields count, including duplicate singular/unknown fields; packed arrays
// additionally count each number. Unknown bytes remain opaque. Groups cannot
// reach the generated decoder's recursive skip, and known message recursion is
// bounded by the fixed schema (WriteRequest → TimeSeries → Exemplar → Label).
func validateWriteMessage(ctx context.Context, payload []byte, kind writeSchema, remaining *int) error {
	for len(payload) > 0 {
		if err := consumeElement(ctx, remaining); err != nil {
			return err
		}
		number, wire, n := protowire.ConsumeTag(payload)
		if n < 0 || number <= 0 || number > protowire.MaxValidNumber || wire == protowire.StartGroupType || wire == protowire.EndGroupType {
			return writeFailure(spi.ErrBadRequest)
		}
		payload = payload[n:]
		child, isMessage, expected, known, packed, isString := writeField(kind, number)
		if known && wire != expected && (!packed || wire != protowire.BytesType) {
			return writeFailure(spi.ErrBadRequest)
		}
		if wire == protowire.BytesType {
			bytes, n := protowire.ConsumeBytes(payload)
			if n < 0 {
				return writeFailure(spi.ErrBadRequest)
			}
			switch {
			case isMessage:
				if err := validateWriteMessage(ctx, bytes, child, remaining); err != nil {
					return err
				}
			case packed:
				if err := validatePacked(ctx, bytes, expected, remaining); err != nil {
					return err
				}
			case isString:
				if !utf8.Valid(bytes) {
					return writeFailure(spi.ErrBadRequest)
				}
			}
			payload = payload[n:]
		} else {
			n := protowire.ConsumeFieldValue(number, wire, payload)
			if n < 0 {
				return writeFailure(spi.ErrBadRequest)
			}
			payload = payload[n:]
		}
	}
	return nil
}
func consumeElement(ctx context.Context, remaining *int) error {
	if err := ctx.Err(); err != nil {
		return spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
	}
	if *remaining <= 0 {
		return writeFailure(spi.ErrTooLarge)
	}
	*remaining--
	return nil
}
func validatePacked(ctx context.Context, payload []byte, wire protowire.Type, remaining *int) error {
	for len(payload) > 0 {
		if err := consumeElement(ctx, remaining); err != nil {
			return err
		}
		n := protowire.ConsumeFieldValue(1, wire, payload)
		if n < 0 {
			return writeFailure(spi.ErrBadRequest)
		}
		payload = payload[n:]
	}
	return nil
}

// The scalar wire types and packed compatibility are from the pinned v1
// prompb schema; unsupported future fields are skipped as opaque protobuf.
func writeField(kind writeSchema, n protowire.Number) (child writeSchema, message bool, wire protowire.Type, known, packed, str bool) {
	switch kind {
	case writeRequest:
		switch n {
		case 1:
			return timeSeries, true, protowire.BytesType, true, false, false
		case 3:
			return metadata, true, protowire.BytesType, true, false, false
		}
	case timeSeries:
		switch n {
		case 1:
			return label, true, protowire.BytesType, true, false, false
		case 2:
			return sample, true, protowire.BytesType, true, false, false
		case 3:
			return exemplar, true, protowire.BytesType, true, false, false
		case 4:
			return histogram, true, protowire.BytesType, true, false, false
		}
	case label:
		if n == 1 || n == 2 {
			return 0, false, protowire.BytesType, true, false, true
		}
	case sample:
		switch n {
		case 1:
			return 0, false, protowire.Fixed64Type, true, false, false
		case 2:
			return 0, false, protowire.VarintType, true, false, false
		}
	case exemplar:
		switch n {
		case 1:
			return label, true, protowire.BytesType, true, false, false
		case 2:
			return 0, false, protowire.Fixed64Type, true, false, false
		case 3:
			return 0, false, protowire.VarintType, true, false, false
		}
	case histogram:
		switch n {
		case 1, 4, 6, 14, 15:
			return 0, false, protowire.VarintType, true, false, false
		case 2, 3, 5, 7:
			return 0, false, protowire.Fixed64Type, true, false, false
		case 8, 11:
			return bucketSpan, true, protowire.BytesType, true, false, false
		case 9, 12:
			return 0, false, protowire.VarintType, true, true, false
		case 10, 13:
			return 0, false, protowire.Fixed64Type, true, true, false
		}
	case bucketSpan:
		if n == 1 || n == 2 {
			return 0, false, protowire.VarintType, true, false, false
		}
	case metadata:
		if n == 1 {
			return 0, false, protowire.VarintType, true, false, false
		}
		if n == 2 || n == 4 || n == 5 {
			return 0, false, protowire.BytesType, true, false, true
		}
	}
	return 0, false, 0, false, false, false
}

func validateLabels(ctx context.Context, input []prompb.Label, requireMetric bool) error {
	names := make(map[string]struct{}, len(input))
	metricName := ""
	for _, entry := range input {
		if err := ctx.Err(); err != nil {
			return spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
		}
		if entry.Name == "" || entry.Value == "" || !utf8.ValidString(entry.Name) || !utf8.ValidString(entry.Value) {
			return writeFailure(spi.ErrBadRequest)
		}
		if _, exists := names[entry.Name]; exists {
			return writeFailure(spi.ErrBadRequest)
		}
		names[entry.Name] = struct{}{}
		if entry.Name == utm.LabelName {
			metricName = entry.Value
		}
	}
	if requireMetric && !model.IsValidMetricName(model.LabelValue(metricName)) {
		return writeFailure(spi.ErrBadRequest)
	}
	return nil
}
func validateWriteSeries(ctx context.Context, request *prompb.WriteRequest) error {
	for _, series := range request.Timeseries {
		if err := validateLabels(ctx, series.Labels, true); err != nil {
			return err
		}
		for i, point := range series.Samples {
			if err := ctx.Err(); err != nil {
				return spi.Wrap(spi.ErrTimeout, "", "remote_write", err)
			}
			if i > 0 && point.Timestamp < series.Samples[i-1].Timestamp {
				return writeFailure(spi.ErrBadRequest)
			}
		}
		for _, point := range series.Exemplars {
			if err := validateLabels(ctx, point.Labels, false); err != nil {
				return err
			}
		}
	}
	return nil
}
