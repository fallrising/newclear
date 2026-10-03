package com.fallrising.cms.content.query;

import java.util.UUID;

/** Keeps entries whose cms_entry_ref has (fieldKey, targetId). */
public record RefFilter(String fieldKey, UUID targetId) {}
