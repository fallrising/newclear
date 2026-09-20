package com.fallrising.cms.content.domain;

import java.util.UUID;

public record EntryRefRecord(UUID fromEntryId, String fieldKey, UUID toId, String toKind, int sortPosition) {}
