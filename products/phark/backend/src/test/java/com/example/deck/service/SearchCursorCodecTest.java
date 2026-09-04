package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.SearchCursor;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class SearchCursorCodecTest {

    private final SearchCursorCodec codec = new SearchCursorCodec();

    @Test
    void canonicalEncodeIsUnpaddedUrlSafeBase64() {
        SearchCursor cursor = new SearchCursor(Instant.ofEpochSecond(1722249600), 42);

        String encoded = codec.encode(cursor);

        assertThat(encoded)
                .isEqualTo("czE6MTcyMjI0OTYwMDo0Mg")
                .matches("[A-Za-z0-9_-]+")
                .doesNotContain("=");
    }

    @Test
    void positiveEpochRoundTrips() {
        SearchCursor original = new SearchCursor(Instant.ofEpochSecond(1722249600), 42);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @Test
    void zeroEpochRoundTrips() {
        SearchCursor original = new SearchCursor(Instant.ofEpochSecond(0), 42);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @Test
    void negativeEpochRoundTrips() {
        for (long epoch : new long[] {-86400L, -1L, -1000000L}) {
            SearchCursor original = new SearchCursor(Instant.ofEpochSecond(epoch), 7);

            assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
        }
    }

    @Test
    void lastEdgeAndMaxIdsRoundTrip() {
        for (long id : new long[] {1L, 1000L, 1234567890123456789L, Long.MAX_VALUE}) {
            SearchCursor original = new SearchCursor(Instant.ofEpochSecond(1722249600), id);

            assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
        }
    }

    @Test
    void maxInstantEpochRoundTrips() {
        long epoch = Instant.MAX.getEpochSecond();
        SearchCursor original = new SearchCursor(Instant.ofEpochSecond(epoch), 42);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @Test
    void minInstantEpochRoundTrips() {
        long epoch = Instant.MIN.getEpochSecond();
        SearchCursor original = new SearchCursor(Instant.ofEpochSecond(epoch), 1);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @Test
    void fractionalInstantIsTruncatedToWholeSecond() {
        SearchCursor cursor = new SearchCursor(
                Instant.parse("2026-07-29T12:34:56.789Z"), 42);

        String encoded = codec.encode(cursor);
        SearchCursor decoded = codec.decode(encoded);

        assertThat(decoded.createdAt()).isEqualTo(Instant.ofEpochSecond(1785328496));
        assertThat(decoded.id()).isEqualTo(42);
    }

    @Test
    void lockStepTruncationKeepsRoundTripInCanonicalForm() {
        Instant fractional = Instant.parse("2026-07-29T12:34:56.789Z");
        SearchCursor original = new SearchCursor(fractional, 42);

        assertThat(original.createdAt()).isEqualTo(Instant.ofEpochSecond(1785328496));
        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {
            " ",
            "\t",
            "czE6MTcyMjI0OTYwMDo0Mg "
    })
    void nullBlankOrWhitespaceIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "czE6MTcyMjI0OTYwMDo0Mg=",
            "czE6MTcyMjI0OTYwMDo0Mg==",
            "czE6+TcyMjI0OTYwMDo0Mg",
            "czE6MTcyMjI0OTYwMDo0/g",
            "czE6MTcyMjI0OTYwMDo+M"
    })
    void paddedOrIllegalAlphabetTokensAreRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "MToxNzIyMjQ5NjAwOjQy",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6NDI",
            "MTo5MQ"
    })
    void legacyTimelineV2AndNotificationTokensAreRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @Test
    void malformedUtf8PayloadFromLegalBase64UrlTokenIsRejected() {
        assertThatThrownBy(() -> codec.decode("gA"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @Test
    void decoderRejectsMalformedBase64Unit() {
        assertThatThrownBy(() -> codec.decode("c"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @Test
    void byteEquivalentNonCanonicalBase64SlackIsRejectedByExactReencode() {
        assertThatThrownBy(() -> codec.decode("czE6MTcyMjI0OTYwMDo0Mh"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "czE6KzE3MjIyNDk2MDA6NDI",
            "czE6MTcyMjI0OTYwMDorNDI",
            "czE6MTcyMjI0OTYwMDotNDI",
            "czE6MTcyMjI0OTYwMDow",
            "czE6MTcyMjI0OTYwMDowNDI",
            "czE6LTA6NDI",
            "czE6MDE3MjIyNDk2MDA6NDI"
    })
    void plusNegativeZeroOrLeadingZeroEpochOrIdIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "czE6OTIyMzM3MjAzNjg1NDc3NTgwNzo0Mg",
            "czE6OTIyMzM3MjAzNjg1NDc3NTgwODo0Mg",
            "czE6MTcyMjI0OTYwMDo5MjIzMzcyMDM2ODU0Nzc1ODA4"
    })
    void numericOrInstantOverflowIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "czE6",
            "czE6MTcyMjI0OTYwMDo0Mjo3",
            "czE6LTg2NDAwOiA3",
            "czE6eA"
    })
    void wrongShapeOrNonDigitPayloadIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }
}