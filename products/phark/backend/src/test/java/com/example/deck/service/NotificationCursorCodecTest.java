package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.NotificationCursor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class NotificationCursorCodecTest {

    private final NotificationCursorCodec codec = new NotificationCursorCodec();

    @Test
    void exactTokenForId91IsCanonicalUnpaddedUrlSafe() {
        String encoded = codec.encode(new NotificationCursor(91));

        assertThat(encoded)
                .isEqualTo("MTo5MQ")
                .doesNotContain("=")
                .matches("[A-Za-z0-9_-]+");
    }

    @Test
    void positiveLongIdsRoundTrip() {
        for (long id : new long[] {
                1L, 42L, 91L, 1000L, 1234567890123456789L, Long.MAX_VALUE}) {
            NotificationCursor original = new NotificationCursor(id);

            NotificationCursor decoded = codec.decode(codec.encode(original));

            assertThat(decoded).isEqualTo(original);
        }
    }

    @Test
    void positiveIdsNeverPadOrUseNonUrlCharacters() {
        String encoded = codec.encode(new NotificationCursor(Long.MAX_VALUE));

        assertThat(encoded).doesNotContain("=").matches("[A-Za-z0-9_-]+");
    }

    @Test
    void timelineLegacyCursorIsRejected() {
        assertThatThrownBy(() -> codec.decode("MTcyMjI0OTYwMDo0Mg"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
            "",
            " ",
            "MTo 5MQ",
            "not*base64",
            "bm90LWN1cnNvcg",
            "MTo",
            "wzg",
            "gA",
            "MTo5MQ=",
            "MTo5MQ==",
            "Mjo5MQ",
            "MTo5MTpleHRyYQ",
            "MTow",
            "MTotNQ",
            "MTorNQ",
            "MTo5MR",
            "MTowOTE",
            "MTogNQ",
            "MTo5MjIzMzcyMDM2ODU0Nzc1ODA4"
    })
    void malformedCursorIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }
}
