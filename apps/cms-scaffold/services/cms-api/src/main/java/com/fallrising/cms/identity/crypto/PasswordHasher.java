package com.fallrising.cms.identity.crypto;

import com.fallrising.cms.identity.IdentityProperties;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class PasswordHasher {

    private final Argon2PasswordEncoder encoder;
    private final String dummyHash;

    public PasswordHasher(IdentityProperties properties) {
        this.encoder = new Argon2PasswordEncoder(16, 32, 1, properties.getArgon2MemoryKb(), properties.getArgon2Iterations());
        this.dummyHash = encoder.encode("not-a-real-user");
    }

    public String dummyHash() {
        return dummyHash;
    }

    public String hash(String raw) {
        return encoder.encode(raw);
    }

    public boolean matches(String raw, String encoded) {
        if (raw == null || encoded == null) {
            return false;
        }
        return encoder.matches(raw, encoded);
    }

    public String algo() {
        return "argon2id";
    }
}
