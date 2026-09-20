package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.store.ContentStore;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@Order(100)
public class ContentTypeSeed {

    private final ContentStore store;

    public ContentTypeSeed(ContentStore store) {
        this.store = store;
    }

    @Order(100)
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        seed();
    }

    public void seed() {
        type("album", "Album", "Albums", "title", "required", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("description", "markdown", false, false, null, List.of()),
                field("cover", "media-ref", false, false, null, List.of(), true),
                field("visibility", "enum", false, true, null, List.of("public", "unlisted")),
                field("sortMode", "enum", false, false, null, List.of("manual", "captured_at"))));
        type("photo", "Photo", "Photos", "title", "optional", false, List.of("album"), List.of(
                field("title", "string", false, true, null, List.of()),
                field("caption", "string", false, false, null, List.of()),
                field("album", "ref", true, false, "album", List.of()),
                field("sortOrder", "int", false, true, null, List.of()),
                field("takenAt", "datetime", false, false, null, List.of()),
                field("media", "media-ref", false, false, null, List.of(), true)));
        type("page", "Page", "Pages", "title", "required", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("body", "markdown", false, false, null, List.of())));
        type("clinic_profile", "Clinic profile", "Clinic profiles", "name", "required", true, List.of(), List.of(
                field("name", "string", true, true, null, List.of()),
                field("intro", "markdown", true, false, null, List.of()),
                field("address", "string", false, false, null, List.of()),
                field("telephone", "string", false, false, null, List.of()),
                field("hours", "markdown", false, false, null, List.of()),
                field("hero", "media-ref", false, false, null, List.of(), true)));
        type("owner", "Owner", "Owners", "title", "optional", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("firstName", "string", false, true, null, List.of()),
                field("lastName", "string", false, true, null, List.of()),
                field("address", "string", false, false, null, List.of()),
                field("city", "string", false, true, null, List.of()),
                field("telephone", "string", false, false, null, List.of()),
                field("email", "string", false, false, null, List.of()),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of())));
        type("pet", "Pet", "Pets", "title", "optional", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("name", "string", false, true, null, List.of()),
                field("petType", "enum", false, true, null, List.of("cat", "dog", "bird", "hamster", "lizard", "snake", "other")),
                field("birthDate", "datetime", false, false, null, List.of()),
                field("owner", "ref", true, false, "owner", List.of()),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()),
                field("notes", "markdown", false, false, null, List.of()),
                field("photo", "media-ref", false, false, null, List.of(), true)));
        type("vet", "Vet", "Vets", "title", "optional", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("firstName", "string", false, true, null, List.of()),
                field("lastName", "string", false, true, null, List.of()),
                field("specialty", "enum", false, true, null, List.of("general", "radiology", "surgery", "dentistry")),
                field("bio", "markdown", false, false, null, List.of()),
                field("photo", "media-ref", false, false, null, List.of(), true)));
        type("visit", "Visit", "Visits", "title", "none", false, List.of(), List.of(
                field("title", "string", false, true, null, List.of()),
                field("pet", "ref", true, false, "pet", List.of()),
                field("owner", "ref", false, false, "owner", List.of()),
                field("vet", "ref", false, false, "vet", List.of()),
                field("scheduledAt", "datetime", false, true, null, List.of()),
                field("description", "string", false, false, null, List.of()),
                field("visitKind", "enum", false, true, null, List.of("checkup", "vaccine", "surgery", "other")),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of())));
        type("project", "Project", "Projects", "title", "required", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("summary", "markdown", false, false, null, List.of()),
                field("cover", "media-ref", false, false, null, List.of(), true),
                field("visibility", "enum", false, true, null, List.of("public", "private")),
                field("lifecycle", "enum", false, true, null, List.of("active", "completed"))));
        type("issue", "Issue", "Issues", "title", "optional", false, List.of(), List.of(
                field("title", "string", true, true, null, List.of()),
                field("project", "ref", true, false, "project", List.of()),
                field("milestone", "ref", false, false, "milestone", List.of()),
                field("body", "markdown", false, false, null, List.of()),
                field("status", "enum", true, true, null, List.of("backlog", "ready", "in_progress", "in_review", "done")),
                field("assigneePrincipalId", "string", false, true, null, List.of()),
                field("sortOrder", "int", false, true, null, List.of())));
        type("milestone", "Milestone", "Milestones", "title", "required", false, List.of("project"), List.of(
                field("title", "string", true, true, null, List.of()),
                field("project", "ref", true, false, "project", List.of()),
                field("description", "markdown", false, false, null, List.of()),
                field("dueDate", "datetime", false, false, null, List.of()),
                field("status", "enum", false, true, null, List.of("planned", "reached", "missed")),
                field("sortOrder", "int", false, true, null, List.of())));
        store.markMediaRefsPublic();
        if (store.findNavigation("front.primary").isEmpty()) {
            Instant now = Instant.now();
            store.upsertNavigation(new NavigationRecord(
                    UUID.randomUUID(),
                    "front.primary",
                    "front",
                    "draft",
                    1,
                    Map.of("items", List.of(
                            Map.of("label", "Albums", "href", "/album"),
                            Map.of("label", "Clinic", "href", "/clinic"),
                            Map.of("label", "Projects", "href", "/projects"))),
                    null,
                    null,
                    now));
        }
    }

    private void type(
            String key,
            String name,
            String plural,
            String titleField,
            String slugPolicy,
            boolean singleton,
            List<String> publishedRefs,
            List<FieldSpec> fields) {
        Instant now = Instant.now();
        ContentTypeRecord type = store.findTypeByKey(key).orElseGet(() -> {
            ContentTypeRecord created = new ContentTypeRecord(
                    UUID.randomUUID(),
                    key,
                    name,
                    plural,
                    null,
                    titleField,
                    slugPolicy,
                    singleton,
                    true,
                    true,
                    publishedRefs,
                    now,
                    now);
            store.insertType(created);
            return created;
        });
        List<FieldRecord> existing = store.fieldsOf(type.id());
        Set<String> have = existing.stream().map(FieldRecord::fieldKey).collect(Collectors.toSet());
        int order = existing.stream().mapToInt(FieldRecord::sortOrder).max().orElse(-1) + 1;
        for (FieldSpec spec : fields) {
            if (have.contains(spec.key)) {
                continue;
            }
            store.insertField(new FieldRecord(
                    UUID.randomUUID(),
                    type.id(),
                    spec.key,
                    spec.type,
                    spec.required,
                    false,
                    spec.indexed,
                    "public",
                    order++,
                    spec.refTarget,
                    "restrict",
                    spec.enums,
                    true,
                    spec.publicBytes));
        }
    }

    private static FieldSpec field(String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums) {
        return field(key, type, required, indexed, refTarget, enums, false);
    }

    private static FieldSpec field(
            String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums, boolean publicBytes) {
        return new FieldSpec(key, type, required, indexed, refTarget, enums, publicBytes);
    }

    private record FieldSpec(
            String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums, boolean publicBytes) {}
}
