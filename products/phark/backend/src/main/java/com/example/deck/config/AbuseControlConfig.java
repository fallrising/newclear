package com.example.deck.config;

import com.example.deck.service.ClientSignalHasher;
import java.util.Arrays;
import java.util.Base64;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

@Configuration(proxyBeanMethods = false)
public class AbuseControlConfig {

    static final String DEVELOPMENT_SECRET =
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final Pattern UNPADDED_BASE64_URL = Pattern.compile("[A-Za-z0-9_-]{43}");

    @Bean
    public ClientSignalHasher clientSignalHasher(
            @Value("${app.abuse.ip-hmac-secret:}") String encodedSecret,
            Environment environment) {
        byte[] secret = decodeSecret(encodedSecret);
        try {
            if (environment.acceptsProfiles(Profiles.of("prod"))
                    && DEVELOPMENT_SECRET.equals(encodedSecret)) {
                throw new IllegalStateException(
                        "The production abuse-control HMAC secret is unsafe");
            }
            return new ClientSignalHasher(secret);
        } finally {
            Arrays.fill(secret, (byte) 0);
        }
    }

    private byte[] decodeSecret(String encodedSecret) {
        if (encodedSecret == null || !UNPADDED_BASE64_URL.matcher(encodedSecret).matches()) {
            throw new IllegalStateException(
                    "The abuse-control HMAC secret must be an unpadded 32-byte base64url value");
        }

        try {
            byte[] decoded = Base64.getUrlDecoder().decode(encodedSecret);
            boolean canonical = Base64.getUrlEncoder()
                    .withoutPadding()
                    .encodeToString(decoded)
                    .equals(encodedSecret);
            if (decoded.length != 32 || !canonical) {
                Arrays.fill(decoded, (byte) 0);
                throw new IllegalStateException(
                        "The abuse-control HMAC secret must be canonical and decode to exactly 32 bytes");
            }
            return decoded;
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "The abuse-control HMAC secret is not valid base64url", exception);
        }
    }
}
