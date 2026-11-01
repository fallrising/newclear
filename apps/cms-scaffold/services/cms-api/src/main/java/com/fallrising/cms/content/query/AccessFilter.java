package com.fallrising.cms.content.query;

import java.util.List;

/**
 * Authorization pushed into the query (02 §4.1, B-10). unrestricted = no condition. Otherwise an entry matches when
 * any clause matches: the index row of clause.fieldKey (in the query scope, kind string/enum/ref) equals clause.value.
 * An empty clause list with unrestricted=false matches nothing.
 */
public record AccessFilter(boolean unrestricted, List<Clause> anyOf) {

    public record Clause(String fieldKey, String value) {}

    public AccessFilter {
        anyOf = List.copyOf(anyOf);
    }

    public static AccessFilter none() {
        return new AccessFilter(true, List.of());
    }

    public static AccessFilter anyOf(List<Clause> clauses) {
        return new AccessFilter(false, clauses);
    }
}
