package com.example.deck.service;

import com.example.deck.model.PostCursor;
import com.example.deck.model.TimelineEntryKind;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.Base64;
import org.springframework.stereotype.Component;

@Component
public class PostCursorCodec {

    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    public String encode(PostCursor cursor) {
        String payload = "2:" + cursor.createdAt().getEpochSecond() + ":"
                + cursor.entryKind().canonical() + ":" + cursor.id();
        return ENCODER.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }

    public PostCursor decode(String encoded) {
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

        if (payload.startsWith("2:")) {
            return decodeV2(payload, encoded);
        } else if (payload.contains(":")) {
            return decodeLegacy(payload, encoded);
        } else {
            throw invalidCursor();
        }
    }

    private PostCursor decodeV2(String payload, String encoded) {
        try {
            String[] parts = payload.split(":", -1);
            if (parts.length != 4 || !"2".equals(parts[0])) {
                throw invalidCursor();
            }

            long epochSecond = Long.parseLong(parts[1]);
            Instant.ofEpochSecond(epochSecond);

            TimelineEntryKind kind;
            try {
                kind = TimelineEntryKind.valueOf(parts[2]);
            } catch (IllegalArgumentException e) {
                throw invalidCursor();
            }
            if (!parts[2].equals(kind.canonical())) {
                throw invalidCursor();
            }

            long id = Long.parseLong(parts[3]);
            if (id <= 0) {
                throw invalidCursor();
            }

            PostCursor cursor = new PostCursor(Instant.ofEpochSecond(epochSecond), kind, id);

            String canonical = "2:" + epochSecond + ":" + kind.canonical() + ":" + id;
            if (!encoded.equals(
                    ENCODER.encodeToString(canonical.getBytes(StandardCharsets.UTF_8)))) {
                throw invalidCursor();
            }
            return cursor;
        } catch (NumberFormatException | DateTimeException e) {
            throw invalidCursor();
        }
    }

    private PostCursor decodeLegacy(String payload, String encoded) {
        try {
            String[] parts = payload.split(":", -1);
            if (parts.length != 2) {
                throw invalidCursor();
            }

            long epochSecond = Long.parseLong(parts[0]);
            long postId = Long.parseLong(parts[1]);
            if (postId <= 0) {
                throw invalidCursor();
            }

            PostCursor cursor = new PostCursor(Instant.ofEpochSecond(epochSecond), postId);

            String legacyCanonical = epochSecond + ":" + postId;
            if (!encoded.equals(
                    ENCODER.encodeToString(legacyCanonical.getBytes(StandardCharsets.UTF_8)))) {
                throw invalidCursor();
            }
            return cursor;
        } catch (NumberFormatException | DateTimeException e) {
            throw invalidCursor();
        }
    }

    private IllegalArgumentException invalidCursor() {
        return new IllegalArgumentException("Invalid cursor");
    }
}
