package normalize

import (
	"cmp"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.opentelemetry.io/collector/pdata/pcommon"
)

var resourceFieldAttributes = [...]string{
	"service.name",
	"service.instance.id",
	"host.id",
	"service.version",
	"service.namespace",
	"host.name",
	"k8s.node.name",
	"net.host.name",
	"k8s.cluster.name",
	"prism.cluster",
	"deployment.environment.name",
	"deployment.environment",
}

func (n *Normalizer) normalizeResource(resource pcommon.Resource, defaultService bool, report *Report) *utm.Resource {
	attributes := resource.Attributes()
	attrs, dropped := flattenAttributes(attributes, n.options.MaxAttrsPerRecord)
	if dropped > 0 {
		report.normalized("truncate")
		report.warning("attributes_truncated")
	}

	value := func(key string) string {
		attribute, found := attributes.Get(key)
		if !found {
			return ""
		}
		return SerializeAnyValue(attribute)
	}
	service := value("service.name")
	if defaultService && service == "" {
		service = "unknown_service"
	}
	for _, key := range resourceFieldAttributes {
		delete(attrs, key)
	}
	if len(attrs) == 0 {
		attrs = nil
	}
	if resource.DroppedAttributesCount() > 0 {
		report.UpstreamDropped += uint64(resource.DroppedAttributesCount())
	}

	return &utm.Resource{
		Tenant:          n.options.Tenant,
		Service:         service,
		ServiceInstance: cmp.Or(value("service.instance.id"), value("host.id")),
		ServiceVersion:  value("service.version"),
		Namespace:       value("service.namespace"),
		Host:            cmp.Or(value("host.name"), value("k8s.node.name"), value("net.host.name")),
		Cluster:         cmp.Or(value("k8s.cluster.name"), value("prism.cluster")),
		Env:             cmp.Or(value("deployment.environment.name"), value("deployment.environment")),
		Attrs:           attrs,
	}
}
