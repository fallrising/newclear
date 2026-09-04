package server

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

func spanAttrs(ctx context.Context, attrs ...attribute.KeyValue) {
	span := trace.SpanFromContext(ctx)
	if span == nil || !span.IsRecording() {
		return
	}
	span.SetAttributes(attrs...)
}

func attrQueue(name string) attribute.KeyValue {
	return attribute.String("clarkq.queue", name)
}

func attrMessageID(id string) attribute.KeyValue {
	return attribute.String("clarkq.message_id", id)
}

func attrOp(op string) attribute.KeyValue {
	return attribute.String("clarkq.op", op)
}

func attrAuth(method string) attribute.KeyValue {
	return attribute.String("clarkq.auth", method)
}

func attrClusterNode(node string) attribute.KeyValue {
	return attribute.String("clarkq.cluster.node", node)
}
