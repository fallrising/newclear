package com.example.deck.service;

import com.example.deck.model.NotificationCursor;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.springframework.stereotype.Component;

@Component
public class NotificationCursorCodec {

    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    public String encode(NotificationCursor cursor) {
        String payload = "1:" + cursor.id();
        return ENCODER.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }

    public NotificationCursor decode(String encoded) {
        if (encoded == null || encoded.isBlank()) {
            throw invalidCursor();
        }

        if (encoded.contains("=") || !encoded.matches("[A-Za-z0-9_-]+")) {
            throw invalidCursor();
        }

        byte[] bytes;
        try {
            bytes = DECODER.decode(encoded);
        } catch (IllegalArgumentException e) {
            throw invalidCursor();
        }

        String payload;
        try {
            payload = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException exception) {
            throw invalidCursor();
        }

        if (!payload.startsWith("1:")) {
            throw invalidCursor();
        }

        return decodeV1(payload, encoded);
    }

    private NotificationCursor decodeV1(String payload, String encoded) {
        try {
            String[] parts = payload.split(":", -1);
            if (parts.length != 2 || !"1".equals(parts[0])) {
                throw invalidCursor();
            }

            long id = Long.parseLong(parts[1]);
            if (id <= 0) {
                throw invalidCursor();
            }

            NotificationCursor cursor = new NotificationCursor(id);

            String canonical = "1:" + id;
            if (!encoded.equals(
                    ENCODER.encodeToString(canonical.getBytes(StandardCharsets.UTF_8)))) {
                throw invalidCursor();
            }
            return cursor;
        } catch (NumberFormatException e) {
            throw invalidCursor();
        }
    }

    private IllegalArgumentException invalidCursor() {
        return new IllegalArgumentException("Invalid cursor");
    }
}
