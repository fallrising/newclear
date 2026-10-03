package ingest

import (
	"reflect"
	"slices"
	"strings"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// footprint counts logical owned bytes (including headers) and elements before
// cloning. Subtraction makes every addition overflow-safe. Inputs are only UTM
// structs or slices, with no recursive pointer graph.
type footprint struct{ bytes, elements, maxBytes, maxElements int }

func (f *footprint) add(bytes, elements int) bool {
	if bytes < 0 || elements < 0 || bytes > f.maxBytes-f.bytes || elements > f.maxElements-f.elements {
		return false
	}
	f.bytes += bytes
	f.elements += elements
	return true
}
func (f *footprint) value(v reflect.Value) bool {
	if !v.IsValid() {
		return true
	}
	switch v.Kind() {
	case reflect.Pointer:
		return f.add(8, 1) && (v.IsNil() || f.value(v.Elem()))
	case reflect.Struct:
		for i := range v.NumField() {
			if !f.value(v.Field(i)) {
				return false
			}
		}
		return true
	case reflect.String:
		return f.add(16+v.Len(), 1)
	case reflect.Map:
		if !f.add(48, v.Len()) {
			return false
		}
		it := v.MapRange()
		for it.Next() {
			if !f.value(it.Key()) || !f.value(it.Value()) {
				return false
			}
		}
		return true
	case reflect.Slice:
		if !f.add(24, v.Len()) {
			return false
		}
		for i := range v.Len() {
			if !f.value(v.Index(i)) {
				return false
			}
		}
		return true
	default:
		return f.add(int(v.Type().Size()), 0)
	}
}
func payloadSize[T any](item T) int {
	f := footprint{maxBytes: int(^uint(0) >> 1), maxElements: int(^uint(0) >> 1)}
	if !f.value(reflect.ValueOf(item)) {
		return f.maxBytes
	}
	return max(1, f.bytes)
}
func cloneLabels(input utm.Labels) utm.Labels {
	out := slices.Clone(input)
	for i := range out {
		out[i].Name = strings.Clone(out[i].Name)
		out[i].Value = strings.Clone(out[i].Value)
	}
	return out
}
func cloneAttrs(input map[string]string) map[string]string {
	if input == nil {
		return nil
	}
	out := make(map[string]string, len(input))
	for k, v := range input {
		out[strings.Clone(k)] = strings.Clone(v)
	}
	return out
}
func cloneResource(input *utm.Resource) *utm.Resource {
	if input == nil {
		return nil
	}
	out := *input
	out.Tenant = strings.Clone(out.Tenant)
	out.Service = strings.Clone(out.Service)
	out.ServiceInstance = strings.Clone(out.ServiceInstance)
	out.ServiceVersion = strings.Clone(out.ServiceVersion)
	out.Namespace = strings.Clone(out.Namespace)
	out.Host = strings.Clone(out.Host)
	out.Cluster = strings.Clone(out.Cluster)
	out.Env = strings.Clone(out.Env)
	out.Attrs = cloneAttrs(out.Attrs)
	return &out
}
func cloneMetric(input utm.MetricPoint) utm.MetricPoint {
	input.Name = strings.Clone(input.Name)
	input.Labels = cloneLabels(input.Labels)
	if input.Histogram != nil {
		out := *input.Histogram
		out.Bounds = slices.Clone(out.Bounds)
		out.Counts = slices.Clone(out.Counts)
		input.Histogram = &out
	}
	if input.Exemplar != nil {
		out := *input.Exemplar
		out.Labels = cloneLabels(out.Labels)
		input.Exemplar = &out
	}
	return input
}
func cloneLog(input utm.LogRecord) utm.LogRecord {
	input.Resource = cloneResource(input.Resource)
	input.SeverityText = strings.Clone(input.SeverityText)
	input.Body = strings.Clone(input.Body)
	input.TraceID = strings.Clone(input.TraceID)
	input.SpanID = strings.Clone(input.SpanID)
	input.Labels = cloneLabels(input.Labels)
	input.Attrs = cloneAttrs(input.Attrs)
	return input
}
func cloneSpan(input utm.Span) utm.Span {
	input.Resource = cloneResource(input.Resource)
	input.TraceID = strings.Clone(input.TraceID)
	input.SpanID = strings.Clone(input.SpanID)
	input.ParentSpanID = strings.Clone(input.ParentSpanID)
	input.TraceState = strings.Clone(input.TraceState)
	input.Name = strings.Clone(input.Name)
	input.StatusMsg = strings.Clone(input.StatusMsg)
	input.Attrs = cloneAttrs(input.Attrs)
	input.Events = slices.Clone(input.Events)
	for i := range input.Events {
		input.Events[i].Name = strings.Clone(input.Events[i].Name)
		input.Events[i].Attrs = cloneAttrs(input.Events[i].Attrs)
	}
	input.Links = slices.Clone(input.Links)
	for i := range input.Links {
		input.Links[i].TraceID = strings.Clone(input.Links[i].TraceID)
		input.Links[i].SpanID = strings.Clone(input.Links[i].SpanID)
		input.Links[i].Attrs = cloneAttrs(input.Links[i].Attrs)
	}
	return input
}
