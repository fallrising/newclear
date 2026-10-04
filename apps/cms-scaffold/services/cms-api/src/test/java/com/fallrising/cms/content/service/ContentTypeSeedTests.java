package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.store.InMemoryContentStore;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ContentTypeSeedTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    @Test
    void B03_seedSetsTypeSettings() {
        InMemoryContentStore store = new InMemoryContentStore();
        new ContentTypeSeed(store).seed();
        assertThat(settings(store, "album")).containsExactly(null, "visibility", null);
        assertThat(settings(store, "project")).containsExactly(null, "visibility", null);
        assertThat(settings(store, "photo")).containsExactly("sortOrder", null, null);
        assertThat(settings(store, "milestone")).containsExactly("sortOrder", null, null);
        assertThat(settings(store, "owner")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "pet")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "visit")).containsExactly(null, null, "ownerPrincipalId");
        assertThat(settings(store, "page")).containsExactly(null, null, null);
        assertThat(settings(store, "issue")).containsExactly(null, null, null);
    }

    @Test
    void B05_seedWritesFieldMetadata() {
        InMemoryContentStore store = new InMemoryContentStore();
        new ContentTypeSeed(store).seed();
        FieldRecord visibility = field(store, "album", "visibility");
        assertThat(visibility.label()).isEqualTo("可見性");
        assertThat(visibility.groupKey()).isEqualTo("settings");
        assertThat(visibility.listable()).isTrue();
        assertThat(visibility.filterable()).isTrue();
        assertThat(visibility.enumLabels()).isEqualTo(Map.of("public", "公開", "unlisted", "不公開列出"));
        assertThat(field(store, "album", "cover").groupKey()).isEqualTo("media");
        assertThat(field(store, "photo", "album").groupKey()).isEqualTo("relations");
        assertThat(field(store, "photo", "sortOrder").groupKey()).isEqualTo("settings");
        assertThat(field(store, "photo", "sortOrder").listable()).isFalse();
        assertThat(field(store, "issue", "sortOrder").groupKey()).isEqualTo("main");
        assertThat(field(store, "visit", "scheduledAt").filterable()).isTrue();
        assertThat(field(store, "pet", "birthDate").listable()).isTrue();
        assertThat(field(store, "pet", "birthDate").filterable()).isFalse();
        assertThat(field(store, "clinic_profile", "name").listable()).isTrue();
        assertThat(field(store, "clinic_profile", "address").listable()).isFalse();
        assertThat(field(store, "issue", "status").enumLabels()).containsEntry("in_review", "審查中");
        assertThat(store.listTypes()).allSatisfy(type -> assertThat(store.fieldsOf(type.id()))
                .allSatisfy(f -> assertThat(f.label()).isNotBlank()));
    }

    @Test
    void B03_seedFillsAnExistingDatabaseOnceAndKeepsLaterEdits() {
        InMemoryContentStore store = new InMemoryContentStore();
        ContentTypeRecord album = new ContentTypeRecord(UUID.randomUUID(), "album", "Album", "Albums", null, "title",
                "required", false, true, true, List.of(), T0, T0);
        store.insertType(album);
        FieldRecord title = new FieldRecord(UUID.randomUUID(), album.id(), "title", "string", true, false, true,
                "public", 0, null, "restrict", List.of(), true, false);
        store.insertField(title);

        ContentTypeSeed seed = new ContentTypeSeed(store);
        seed.seed();
        assertThat(settings(store, "album")).containsExactly(null, "visibility", null);
        assertThat(field(store, "album", "title").label()).isEqualTo("標題");

        store.updateFieldMetadata(field(store, "album", "title").withMetadata("名稱", "main", true, false, Map.of(), null, null));
        store.updateTypeSettings(store.findTypeByKey("album").orElseThrow().withSettings(null, "shownTo", null, T0));
        seed.seed();
        assertThat(field(store, "album", "title").label()).isEqualTo("名稱");
        assertThat(settings(store, "album")).containsExactly(null, "shownTo", null);
    }

    @Test
    void B03_seedIsIdempotent() {
        InMemoryContentStore store = new InMemoryContentStore();
        ContentTypeSeed seed = new ContentTypeSeed(store);
        seed.seed();
        List<ContentTypeRecord> types = store.listTypes();
        List<List<FieldRecord>> fields = types.stream().map(t -> store.fieldsOf(t.id())).toList();
        seed.seed();
        assertThat(store.listTypes()).isEqualTo(types);
        assertThat(store.listTypes().stream().map(t -> store.fieldsOf(t.id())).toList()).isEqualTo(fields);
    }

    private static List<String> settings(InMemoryContentStore store, String key) {
        ContentTypeRecord type = store.findTypeByKey(key).orElseThrow();
        return java.util.Arrays.asList(type.sortField(), type.visibilityField(), type.ownerField());
    }

    private static FieldRecord field(InMemoryContentStore store, String type, String key) {
        return store.fieldsOf(store.findTypeByKey(type).orElseThrow().id()).stream()
                .filter(f -> f.fieldKey().equals(key)).findFirst().orElseThrow();
    }
}
