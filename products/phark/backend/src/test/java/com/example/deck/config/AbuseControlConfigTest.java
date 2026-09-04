package com.example.deck.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.service.ClientSignalHasher;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class AbuseControlConfigTest {

    private static final String DEVELOPMENT_SECRET =
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    private static final String PRODUCTION_SECRET =
            "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";

    private final ApplicationContextRunner contextRunner =
            new ApplicationContextRunner().withUserConfiguration(AbuseControlConfig.class);

    @Test
    void validUnpaddedBase64UrlSecretCreatesHasherOutsideProduction() {
        contextRunner
                .withPropertyValues("app.abuse.ip-hmac-secret=" + DEVELOPMENT_SECRET)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(ClientSignalHasher.class);
                });
    }

    @Test
    void productionAcceptsASeparateValidSecret() {
        contextRunner
                .withPropertyValues(
                        "spring.profiles.active=prod",
                        "app.abuse.ip-hmac-secret=" + PRODUCTION_SECRET)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(ClientSignalHasher.class);
                });
    }

    @Test
    void productionRejectsTheCommittedDevelopmentSecret() {
        assertStartupRejected("spring.profiles.active=prod");
        assertStartupRejected("spring.profiles.active=prod",
                "app.abuse.ip-hmac-secret=" + DEVELOPMENT_SECRET);
    }

    @Test
    void missingBlankMalformedPaddedShortAndLongSecretsAreRejected() {
        assertStartupRejected();
        assertStartupRejected("app.abuse.ip-hmac-secret=");
        assertStartupRejected("app.abuse.ip-hmac-secret=not+base64url/value");
        assertStartupRejected("app.abuse.ip-hmac-secret=" + PRODUCTION_SECRET + "=");
        assertStartupRejected("app.abuse.ip-hmac-secret="
                + PRODUCTION_SECRET.substring(0, PRODUCTION_SECRET.length() - 1) + "B");
        assertStartupRejected("app.abuse.ip-hmac-secret=AQIDBAUGBwgJCgsMDQ4PEA");
        assertStartupRejected(
                "app.abuse.ip-hmac-secret=AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAh");
    }

    private void assertStartupRejected(String... properties) {
        contextRunner.withPropertyValues(properties).run(context -> {
            assertThat(context).hasFailed();
            assertThat(context.getStartupFailure())
                    .hasMessageNotContaining(DEVELOPMENT_SECRET)
                    .hasMessageNotContaining(PRODUCTION_SECRET);
        });
    }
}
