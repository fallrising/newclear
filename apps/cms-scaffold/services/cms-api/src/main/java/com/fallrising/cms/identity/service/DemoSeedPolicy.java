package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityProperties;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

@Component
public class DemoSeedPolicy {
    private final IdentityProperties properties;
    private final Environment environment;

    public DemoSeedPolicy(IdentityProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    public boolean enabled() {
        return !environment.acceptsProfiles(Profiles.of("prod")) && properties.isSeedEnabled();
    }
}
