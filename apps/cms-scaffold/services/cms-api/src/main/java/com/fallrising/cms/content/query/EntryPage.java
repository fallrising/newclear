package com.fallrising.cms.content.query;

import com.fallrising.cms.content.domain.EntryRecord;

import java.util.List;

/** One page of a query and the number of matching entries on all pages. */
public record EntryPage(List<EntryRecord> items, long total) {

    public EntryPage {
        items = List.copyOf(items);
    }
}
