package normalize

import (
	"maps"
	"regexp"
	"slices"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/prompb"
	"go.opentelemetry.io/collector/pdata/pcommon"
)

var highCardinalityAttribute = regexp.MustCompile(`^(trace_id|span_id|request_id|session_id|user_id|uuid|.*_uuid|.*\.id|url\.full|http\.url|http\.target)$`)

func (n *Normalizer) metricLabels(attributes pcommon.Map, resource *utm.Resource, report *Report) utm.Labels {
	flattened, dropped := flattenAttributes(attributes, n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	user := make(map[string]string, len(flattened))
	for _, key := range slices.Sorted(maps.Keys(flattened)) {
		if highCardinalityAttribute.MatchString(key) {
			report.normalized("drop")
			report.warning("high_cardinality_label_dropped")
			continue
		}
		name := utm.SanitizeLabelName(key)
		if name != key {
			report.normalized("rename")
		}
		if name == "" || utm.IsReserved(name) {
			report.normalized("drop")
			report.warning("reserved_label_dropped")
			continue
		}
		if _, exists := user[name]; exists {
			report.normalized("drop")
			report.warning("label_collision")
			continue
		}
		user[name] = flattened[key]
	}
	return resource.ToLabels(labels.FromMap(user))
}

func (n *Normalizer) logLabelsAndAttrs(attributes pcommon.Map, resource *utm.Resource, report *Report) (utm.Labels, map[string]string) {
	flattened, dropped := flattenAttributes(attributes, n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}
	labelValues := make(map[string]string)
	attrs := make(map[string]string, len(flattened))
	for _, key := range slices.Sorted(maps.Keys(flattened)) {
		_, allowed := n.logAllowlist[key]
		if !allowed || highCardinalityAttribute.MatchString(key) {
			attrs[key] = flattened[key]
			continue
		}
		name := utm.SanitizeLabelName(key)
		if name != key {
			report.normalized("rename")
		}
		if name == "" || utm.IsReserved(name) {
			attrs[key] = flattened[key]
			report.normalized("drop")
			report.warning("reserved_label_dropped")
			continue
		}
		if _, exists := labelValues[name]; exists {
			attrs[key] = flattened[key]
			report.warning("label_collision")
			continue
		}
		labelValues[name] = flattened[key]
	}
	if len(attrs) == 0 {
		attrs = nil
	}
	return resource.ToLabels(labels.FromMap(labelValues)), attrs
}

func promLabels(input []prompb.Label, report *Report) (string, utm.Labels) {
	values := make(map[string]string, len(input))
	name := ""
	for _, label := range input {
		if label.Name == utm.LabelName {
			name = label.Value
			continue
		}
		labelName := utm.SanitizeLabelName(label.Name)
		if labelName != label.Name {
			report.normalized("rename")
		}
		if labelName == "" || utm.IsReserved(labelName) {
			report.normalized("drop")
			report.warning("reserved_label_dropped")
			continue
		}
		values[labelName] = validUTF8(label.Value)
	}
	return name, labels.FromMap(values)
}
