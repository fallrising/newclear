package dev.ojbk.config;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.TreeMap;

/** Explicit complete local runtime topology; never inferred from current broker membership. */
public record RuntimeRoster(Map<String, URI> endpoints, String fingerprint) {
    public RuntimeRoster { endpoints = Map.copyOf(endpoints); }

    public static RuntimeRoster parse(String text) {
        TreeMap<String, URI> entries = new TreeMap<>();
        if (text != null && !text.isBlank()) {
            for (String part : text.split(";", -1)) {
                String[] pair = part.trim().split("=", 2);
                if (pair.length != 2 || !pair[0].matches("[A-Za-z0-9_.-]{1,128}"))
                    throw new IllegalArgumentException("invalid consume runtime roster");
                URI uri = URI.create(pair[1].trim());
                if (!"http".equals(uri.getScheme()) || uri.getHost() == null
                        || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                        || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))
                    throw new IllegalArgumentException("roster requires direct internal HTTP endpoints");
                if (entries.putIfAbsent(pair[0], uri.resolve("/")) != null)
                    throw new IllegalArgumentException("duplicate runtime identity");
            }
        }
        if (entries.size() > 64) throw new IllegalArgumentException("runtime roster exceeds bound");
        String canonical = entries.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue())
                .collect(java.util.stream.Collectors.joining(";"));
        try {
            return new RuntimeRoster(entries, HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8))));
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    public void requireMember(String instance) {
        if (endpoints.isEmpty() || !endpoints.containsKey(instance))
            throw new IllegalArgumentException("consume runtime must belong to the explicit complete roster");
    }
}
