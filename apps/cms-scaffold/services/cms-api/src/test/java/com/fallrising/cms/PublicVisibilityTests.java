package com.fallrising.cms;

import com.fallrising.cms.content.PublicVisibility;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PublicVisibilityTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    static ContentTypeRecord type(String visibilityField) {
        return new ContentTypeRecord(UUID.randomUUID(), "album", "Album", "Albums", null, "title", "required", false,
                true, true, List.of(), T0, T0, null, visibilityField, null);
    }

    @Test
    void B03_typeWithoutVisibilityFieldIsAlwaysPublic() {
        ContentTypeRecord type = type(null);
        assertThat(PublicVisibility.indexable(type, Map.of("visibility", "private"))).isTrue();
        assertThat(PublicVisibility.gettable(type, Map.of("visibility", "private"))).isTrue();
        assertThat(PublicVisibility.indexable(null, Map.of("visibility", "private"))).isTrue();
    }

    @Test
    void B03_visibilityFieldDecides() {
        ContentTypeRecord type = type("shownTo");
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "public"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "unlisted"))).isFalse();
        assertThat(PublicVisibility.gettable(type, Map.of("shownTo", "unlisted"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", "private"))).isFalse();
        assertThat(PublicVisibility.gettable(type, Map.of("shownTo", "private"))).isFalse();
        assertThat(PublicVisibility.indexable(type, Map.of("visibility", "private"))).isTrue();
        assertThat(PublicVisibility.indexable(type, Map.of("shownTo", " "))).isTrue();
        assertThat(PublicVisibility.indexable(type, null)).isTrue();
    }
}
