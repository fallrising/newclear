package utm

import (
	"maps"

	"github.com/prometheus/prometheus/model/labels"
)

// Resource contains the flattened OpenTelemetry resource attributes used by
// Prism's telemetry model.
type Resource struct {
	Tenant          string
	Service         string
	ServiceInstance string
	ServiceVersion  string
	Namespace       string
	Host            string
	Cluster         string
	Env             string
	Attrs           map[string]string
}

// Clone returns a deep copy of r.
func (r *Resource) Clone() *Resource {
	if r == nil {
		return nil
	}

	clone := *r
	clone.Attrs = maps.Clone(r.Attrs)
	return &clone
}

// ToLabels maps the resource fields defined by the data model to labels. User
// labels are preserved; resource labels gain resource_ prefixes on collisions.
func (r *Resource) ToLabels(existing Labels) Labels {
	if r == nil {
		return existing
	}

	builder := labels.NewBuilder(existing)
	occupied := make(map[string]struct{}, existing.Len()+6)
	existing.Range(func(label labels.Label) {
		occupied[label.Name] = struct{}{}
	})

	instance := r.ServiceInstance
	if instance == "" {
		instance = r.Host
	}
	resourceLabels := [...]labels.Label{
		{Name: "job", Value: r.Service},
		{Name: "instance", Value: instance},
		{Name: "host", Value: r.Host},
		{Name: "cluster", Value: r.Cluster},
		{Name: "env", Value: r.Env},
		{Name: "service", Value: r.Service},
	}
	for _, label := range resourceLabels {
		if label.Value == "" {
			continue
		}
		for {
			if _, found := occupied[label.Name]; !found {
				break
			}
			label.Name = "resource_" + label.Name
		}
		builder.Set(label.Name, label.Value)
		occupied[label.Name] = struct{}{}
	}
	return builder.Labels()
}
