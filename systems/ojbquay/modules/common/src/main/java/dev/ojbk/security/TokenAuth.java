package dev.ojbk.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public final class TokenAuth {
    private TokenAuth() {}

    public static boolean matches(String expected, String provided) {
        if (expected == null || provided == null) {
            return false;
        }
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] providedBytes = provided.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expectedBytes, providedBytes);
    }
}
