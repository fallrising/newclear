package dev.ojbk.console.group;

import java.time.Instant;

public record GroupView(
        long id,
        String name,
        String token,
        String owner,
        short state,
        long version,
        String remark,
        Instant createdAt,
        Instant updatedAt) {}
