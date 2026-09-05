package utm

import (
	"maps"
	"testing"

	"github.com/prometheus/prometheus/model/labels"
)

func TestResourceClone(t *testing.T) {
	t.Parallel()

	var nilResource *Resource
	if nilResource.Clone() != nil {
		t.Fatal("nil Resource.Clone() should return nil")
	}

	original := &Resource{Service: "api", Attrs: map[string]string{"region": "eu"}}
	clone := original.Clone()
	if clone == original || clone.Service != original.Service || !maps.Equal(clone.Attrs, original.Attrs) {
		t.Fatalf("Clone() = %#v, want a deep copy of %#v", clone, original)
	}
	clone.Attrs["region"] = "us"
	if original.Attrs["region"] != "eu" {
		t.Fatal("Clone() shares Attrs with the original")
	}

	withoutAttrs := (&Resource{Service: "worker"}).Clone()
	if withoutAttrs.Attrs != nil {
		t.Fatalf("Clone() changed nil Attrs to %#v", withoutAttrs.Attrs)
	}
}

func TestResourceToLabels(t *testing.T) {
	t.Parallel()

	existing := labels.FromStrings(
		"custom", "kept",
		"job", "user-job",
		"resource_job", "user-resource-job",
	)
	resource := &Resource{
		Service:         "checkout",
		ServiceInstance: "checkout-7",
		Host:            "node-a",
		Cluster:         "prod-eu",
		Env:             "production",
	}
	got := resource.ToLabels(existing)
	want := map[string]string{
		"custom":                "kept",
		"job":                   "user-job",
		"resource_job":          "user-resource-job",
		"resource_resource_job": "checkout",
		"instance":              "checkout-7",
		"host":                  "node-a",
		"cluster":               "prod-eu",
		"env":                   "production",
		"service":               "checkout",
	}
	if !maps.Equal(got.Map(), want) {
		t.Fatalf("ToLabels() = %v, want %v", got.Map(), want)
	}
	if !maps.Equal(existing.Map(), map[string]string{"custom": "kept", "job": "user-job", "resource_job": "user-resource-job"}) {
		t.Fatalf("ToLabels() mutated existing labels: %v", existing)
	}
}

func TestResourceToLabelsUsesHostAsInstanceFallback(t *testing.T) {
	t.Parallel()

	resource := &Resource{Host: "node-a"}
	got := resource.ToLabels(nil).Map()
	want := map[string]string{"host": "node-a", "instance": "node-a"}
	if !maps.Equal(got, want) {
		t.Fatalf("ToLabels() = %v, want %v", got, want)
	}

	var nilResource *Resource
	existing := labels.FromStrings("key", "value")
	if got := nilResource.ToLabels(existing); !maps.Equal(got.Map(), existing.Map()) {
		t.Fatalf("nil Resource.ToLabels() = %v, want %v", got, existing)
	}
}
