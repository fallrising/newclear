package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.PostCursor;
import com.example.deck.model.TimelineEntryKind;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

class PostCursorCodecTest {

    private final PostCursorCodec codec = new PostCursorCodec();

    @Test
    void cursorRoundTripsAsUrlSafeBase64WithoutPadding() {
        PostCursor cursor = new PostCursor(Instant.parse("2026-07-29T12:34:56Z"), 42);

        String encoded = codec.encode(cursor);

        assertThat(encoded).matches("[A-Za-z0-9_-]+").doesNotContain("=");
        assertThat(codec.decode(encoded)).isEqualTo(cursor);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
            "",
            " ",
            "not*base64",
            "bm90LWN1cnNvcg",
            "gA",
            "MTow",
            "MTotMQ",
            "MTox=",
            "MTcyMjI0OTYwMDo0Mh"
    })
    void malformedCursorIsRejected(String encoded) {
        assertThatThrownBy(() -> codec.decode(encoded))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }

    @Test
    void legacyCursorDecodesAsPostEntry() {
        PostCursor cursor = codec.decode("MTcyMjI0OTYwMDo0Mg");

        assertThat(cursor.entryKind()).isEqualTo(TimelineEntryKind.POST);
        assertThat(cursor.createdAt()).isEqualTo(Instant.ofEpochSecond(1722249600));
        assertThat(cursor.id()).isEqualTo(42);
    }

    @Test
    void v2PostEncodeIsUrlSafeWithoutPadding() {
        PostCursor cursor = new PostCursor(
                Instant.ofEpochSecond(1722249600), TimelineEntryKind.POST, 42);

        String encoded = codec.encode(cursor);

        assertThat(encoded)
                .isEqualTo("MjoxNzIyMjQ5NjAwOlBPU1Q6NDI")
                .matches("[A-Za-z0-9_-]+")
                .doesNotContain("=");
    }

    @Test
    void v2RepostEncodeIsUrlSafeWithoutPadding() {
        PostCursor cursor = new PostCursor(
                Instant.ofEpochSecond(1722249600), TimelineEntryKind.REPOST, 17);

        String encoded = codec.encode(cursor);

        assertThat(encoded)
                .isEqualTo("MjoxNzIyMjQ5NjAwOlJFUE9TVDoxNw")
                .matches("[A-Za-z0-9_-]+")
                .doesNotContain("=");
    }

    @Test
    void v2PostCursorRoundTrips() {
        PostCursor original = new PostCursor(
                Instant.ofEpochSecond(1722249600), TimelineEntryKind.POST, 42);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @Test
    void v2RepostCursorRoundTrips() {
        PostCursor original = new PostCursor(
                Instant.ofEpochSecond(1722249600), TimelineEntryKind.REPOST, 17);

        assertThat(codec.decode(codec.encode(original))).isEqualTo(original);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "MzoxNzIyMjQ5NjAwOlBPU1Q6NDI",
            "MjoxNzIyMjQ5NjAwOkxJS0U6NDI",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6MA",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6LTE",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6NDI=",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6NDI6ZXh0cmE",
            "MjoxNzIyMjQ5NjAwOnBvc3Q6NDI"
    })
    void rejectInvalidV2Tokens(String token) {
        assertThatThrownBy(() -> codec.decode(token))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Invalid cursor");
    }
}
