package dev.ojbk.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class TokenAuthTest {

    @Test
    void comparesTokensWithoutAcceptingNullOrDifferentLengthValues() {
        assertThat(TokenAuth.matches("0123456789abcdef", "0123456789abcdef")).isTrue();
        assertThat(TokenAuth.matches("0123456789abcdef", "0123456789abcdee")).isFalse();
        assertThat(TokenAuth.matches("short", "longer")).isFalse();
        assertThat(TokenAuth.matches(null, "value")).isFalse();
    }
}
