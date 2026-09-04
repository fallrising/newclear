package dev.ojbk.console.audit;

import java.util.List;

public record AuditPage(List<AuditEntry> items, long total, int page, int size) {

    public AuditPage {
        items = List.copyOf(items);
    }
}
