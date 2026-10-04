package com.fallrising.cms.content.query;

import com.fallrising.cms.content.index.IndexScope;

import java.util.List;
import java.util.UUID;

/**
 * A list query that a ContentStore evaluates in one pass (02 BD-04). All filters are combined with AND.
 *
 * @param typeId            content type of the entries
 * @param scope             WORK lists working copies; PUBLISHED lists published copies and applies the public rules
 * @param states            publication states to include (WORK only; PUBLISHED always means "published")
 * @param titleField        field searched by q
 * @param q                 case-insensitive literal substring of the titleField index value; null or blank = no filter
 * @param filters           field conditions on index rows of the scope
 * @param refs              relation conditions on cms_entry_ref (field key and target id)
 * @param access            authorization restriction from predicate grants; unrestricted() = none
 * @param visibilityField   PUBLISHED only: raw published visibility must be missing, blank, or "public"
 * @param requiredRefs      PUBLISHED only: every listed ref field that has a value must point to a publicly readable entry
 * @param sort              primary sort key; ties are broken by updatedAt descending, then id text ascending
 * @param page              1-based page
 * @param size              page size, 1..100
 */
public record EntryQuery(
        UUID typeId,
        IndexScope scope,
        List<String> states,
        String titleField,
        String q,
        List<FieldFilter> filters,
        List<RefFilter> refs,
        AccessFilter access,
        String visibilityField,
        List<String> requiredRefs,
        SortKey sort,
        int page,
        int size,
        boolean publishRequested) {

    public EntryQuery(UUID typeId, IndexScope scope, List<String> states, String titleField, String q,
            List<FieldFilter> filters, List<RefFilter> refs, AccessFilter access, String visibilityField,
            List<String> requiredRefs, SortKey sort, int page, int size) {
        this(typeId, scope, states, titleField, q, filters, refs, access, visibilityField, requiredRefs, sort, page, size, false);
    }

    public EntryQuery {
        states = List.copyOf(states);
        filters = List.copyOf(filters);
        refs = List.copyOf(refs);
        requiredRefs = List.copyOf(requiredRefs);
    }

    public long offset() {
        return ((long) page - 1) * size;
    }
}
