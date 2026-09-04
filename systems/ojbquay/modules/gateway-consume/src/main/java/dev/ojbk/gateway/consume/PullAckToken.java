package dev.ojbk.gateway.consume;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.OptionalLong;
import java.util.UUID;

final class PullAckToken {
    private PullAckToken() {}

    static String issue(long subscriptionId, PullRecordId id) {
        String value = "v1|"
                + subscriptionId
                + "|"
                + id.topic()
                + "|"
                + id.partition()
                + "|"
                + id.offset()
                + "|"
                + UUID.randomUUID();
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    static OptionalLong subscriptionId(String token) {
        if (token == null || token.isBlank() || token.length() > 1_024) {
            return OptionalLong.empty();
        }
        try {
            String decoded = new String(
                    Base64.getUrlDecoder().decode(token),
                    StandardCharsets.UTF_8);
            String[] fields = decoded.split("\\|", -1);
            if (fields.length != 6 || !"v1".equals(fields[0])) {
                return OptionalLong.empty();
            }
            long id = Long.parseLong(fields[1]);
            return id > 0 ? OptionalLong.of(id) : OptionalLong.empty();
        } catch (IllegalArgumentException invalid) {
            return OptionalLong.empty();
        }
    }
}
