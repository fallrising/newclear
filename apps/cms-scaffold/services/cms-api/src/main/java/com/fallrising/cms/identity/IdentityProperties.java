package com.fallrising.cms.identity;

import com.fallrising.cms.identity.domain.Surface;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@ConfigurationProperties(prefix = "cms.identity")
public class IdentityProperties {

    private String corsOrigins =
            "http://localhost:5173,http://localhost:5174,http://localhost:5175";
    private String surfaceOrigins =
            "http://localhost:5173:front,http://localhost:5174:back,http://localhost:5175:admin";
    private boolean seedEnabled = true;
    private String seedPassword = "";
    private boolean cookieSecure = false;
    private int argon2MemoryKb = 16384;
    private int argon2Iterations = 3;
    private Duration sessionAbsolute = Duration.ofHours(12);
    private Duration sessionMax = Duration.ofDays(7);
    private int lockoutThreshold = 5;
    private Duration lockoutDuration = Duration.ofMinutes(15);

    public List<String> corsOriginList() {
        return splitCsv(corsOrigins);
    }

    public Map<String, Surface> surfaceOriginMap() {
        Map<String, Surface> map = new LinkedHashMap<>();
        for (String part : splitCsv(surfaceOrigins)) {
            int idx = part.lastIndexOf(':');
            if (idx <= 0) {
                continue;
            }
            String origin = part.substring(0, idx).trim();
            String surface = part.substring(idx + 1).trim();
            if (!origin.isEmpty()) {
                map.put(origin, Surface.fromWire(surface));
            }
        }
        return map;
    }

    public boolean originAllowed(String origin) {
        if (origin == null || origin.isBlank()) {
            return false;
        }
        return corsOriginList().stream().anyMatch(allowed -> allowed.equalsIgnoreCase(origin));
    }

    public Surface surfaceForOrigin(String origin) {
        if (origin == null) {
            return Surface.FRONT;
        }
        Surface mapped = surfaceOriginMap().get(origin);
        return mapped == null ? Surface.FRONT : mapped;
    }

    public String seedPasswordFor(String username) {
        String envKey = "CMS_SEED_PASSWORD_" + username.toUpperCase(Locale.ROOT).replace('-', '_');
        String perUser = System.getenv(envKey);
        if (perUser != null && !perUser.isBlank()) {
            return perUser;
        }
        if (seedPassword != null && !seedPassword.isBlank()) {
            return seedPassword;
        }
        return null;
    }

    private static List<String> splitCsv(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    public String getCorsOrigins() {
        return corsOrigins;
    }

    public void setCorsOrigins(String corsOrigins) {
        this.corsOrigins = corsOrigins;
    }

    public String getSurfaceOrigins() {
        return surfaceOrigins;
    }

    public void setSurfaceOrigins(String surfaceOrigins) {
        this.surfaceOrigins = surfaceOrigins;
    }

    public boolean isSeedEnabled() {
        return seedEnabled;
    }

    public void setSeedEnabled(boolean seedEnabled) {
        this.seedEnabled = seedEnabled;
    }

    public String getSeedPassword() {
        return seedPassword;
    }

    public void setSeedPassword(String seedPassword) {
        this.seedPassword = seedPassword;
    }

    public boolean isCookieSecure() {
        return cookieSecure;
    }

    public void setCookieSecure(boolean cookieSecure) {
        this.cookieSecure = cookieSecure;
    }

    public int getArgon2MemoryKb() {
        return argon2MemoryKb;
    }

    public void setArgon2MemoryKb(int argon2MemoryKb) {
        this.argon2MemoryKb = argon2MemoryKb;
    }

    public int getArgon2Iterations() {
        return argon2Iterations;
    }

    public void setArgon2Iterations(int argon2Iterations) {
        this.argon2Iterations = argon2Iterations;
    }

    public Duration getSessionAbsolute() {
        return sessionAbsolute;
    }

    public void setSessionAbsolute(Duration sessionAbsolute) {
        this.sessionAbsolute = sessionAbsolute;
    }

    public Duration getSessionMax() {
        return sessionMax;
    }

    public void setSessionMax(Duration sessionMax) {
        this.sessionMax = sessionMax;
    }

    public int getLockoutThreshold() {
        return lockoutThreshold;
    }

    public void setLockoutThreshold(int lockoutThreshold) {
        this.lockoutThreshold = lockoutThreshold;
    }

    public Duration getLockoutDuration() {
        return lockoutDuration;
    }

    public void setLockoutDuration(Duration lockoutDuration) {
        this.lockoutDuration = lockoutDuration;
    }
}
