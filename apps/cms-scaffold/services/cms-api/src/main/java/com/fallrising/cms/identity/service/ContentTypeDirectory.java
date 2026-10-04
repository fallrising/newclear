package com.fallrising.cms.identity.service;

import java.util.List;

/** Content type facts that identity needs. Implemented by the content module so identity does not depend on it. */
public interface ContentTypeDirectory {

    /** Enabled content type keys in key order. */
    List<String> enabledTypeKeys();

    /**
     * True when a fieldEquals predicate on fieldKey can be pushed into list queries of typeKey (02 §4.1 step 3):
     * the type exists and the field is enabled, gets index rows (EntryIndexer.indexedKeys) and is of type
     * string, enum, ref or principal-ref.
     */
    boolean predicateFieldCompilable(String typeKey, String fieldKey);
}
