package com.fallrising.cms.identity.domain;

import java.util.List;

/** One page of audit events and the number of matching events on all pages. */
public record AuditPage(List<AuditEvent> items, long total) {

    public AuditPage {
        items = List.copyOf(items);
    }
}
