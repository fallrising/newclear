package com.example.deck.service;

import com.example.deck.model.SearchCursor;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.util.Base64;
import org.springframework.stereotype.Component;

@Component
public class SearchCursorCodec {

    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder DECODER = Base64.getUrlDecoder();

    public String encode(SearchCursor cursor) {
        String payload = "s1:" + cursor.createdAt().getEpochSecond() + ":" + cursor.id();
        return ENCODER.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }

    public SearchCursor decode(String encoded) {
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

        if (!payload.startsWith("s1:")) {
            throw invalidCursor();
        }

        String[] parts = payload.split(":", -1);
        if (parts.length != 3) {
            throw invalidCursor();
        }

        String epochText = parts[1];
        if (!isCanonicalDecimal(epochText, true)) {
            throw invalidCursor();
        }
        String idText = parts[2];
        if (!isCanonicalDecimal(idText, false)) {
            throw invalidCursor();
        }

        long epochSecond;
        long id;
        try {
            epochSecond = Long.parseLong(epochText);
            id = Long.parseLong(idText);
            if (id <= 0) {
                throw invalidCursor();
            }
            Instant.ofEpochSecond(epochSecond);
        } catch (NumberFormatException | DateTimeException e) {
            throw invalidCursor();
        }

        SearchCursor cursor = new SearchCursor(Instant.ofEpochSecond(epochSecond), id);

        String canonical = "s1:" + epochSecond + ":" + id;
        if (!encoded.equals(
                ENCODER.encodeToString(canonical.getBytes(StandardCharsets.UTF_8)))) {
            throw invalidCursor();
        }
        return cursor;
    }

    private static boolean isCanonicalDecimal(String text, boolean allowNegative) {
        if (text.isEmpty()) {
            return false;
        }
        if (allowNegative && text.startsWith("-")) {
            return !text.substring(1).startsWith("0") && allAsciiDigits(text.substring(1));
        }
        return !(text.length() > 1 && text.startsWith("0")) && allAsciiDigits(text);
    }

    private static boolean allAsciiDigits(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < '0' || c > '9') {
                return false;
            }
        }
        return true;
    }

    private IllegalArgumentException invalidCursor() {
        return new IllegalArgumentException("Invalid cursor");
    }
}