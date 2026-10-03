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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Demo content types. Idempotent: missing types and fields are inserted; type settings are written only while all
 * three are null; field metadata is written only while the field label is null. Values edited later are kept.
 */
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
        type("album", "Album", "Albums", "title", "required", false, List.of(), null, "visibility", null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("description", "markdown", false, false, null, List.of()).label("說明"),
                field("cover", "media-ref", false, false, null, List.of(), true).label("封面"),
                field("visibility", "enum", false, true, null, List.of("public", "unlisted"))
                        .label("可見性", labels("public", "公開", "unlisted", "不公開列出")),
                field("sortMode", "enum", false, false, null, List.of("manual", "captured_at"))
                        .label("排序方式", labels("manual", "手動", "captured_at", "拍攝時間"))));
        type("photo", "Photo", "Photos", "title", "optional", false, List.of("album"), "sortOrder", null, null, List.of(
                field("title", "string", false, true, null, List.of()).label("標題"),
                field("caption", "string", false, false, null, List.of()).label("圖說"),
                field("album", "ref", true, false, "album", List.of()).label("相簿"),
                field("sortOrder", "int", false, true, null, List.of()).label("排序"),
                field("takenAt", "datetime", false, false, null, List.of()).label("拍攝時間"),
                field("media", "media-ref", false, false, null, List.of(), true).label("圖片")));
        type("page", "Page", "Pages", "title", "required", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("body", "markdown", false, false, null, List.of()).label("內文")));
        type("clinic_profile", "Clinic profile", "Clinic profiles", "name", "required", true, List.of(), null, null, null, List.of(
                field("name", "string", true, true, null, List.of()).label("名稱"),
                field("intro", "markdown", true, false, null, List.of()).label("簡介"),
                field("address", "string", false, false, null, List.of()).label("地址"),
                field("telephone", "string", false, false, null, List.of()).label("電話"),
                field("hours", "markdown", false, false, null, List.of()).label("門診時間"),
                field("hero", "media-ref", false, false, null, List.of(), true).label("主視覺")));
        type("owner", "Owner", "Owners", "title", "optional", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("firstName", "string", false, true, null, List.of()).label("名"),
                field("lastName", "string", false, true, null, List.of()).label("姓"),
                field("address", "string", false, false, null, List.of()).label("地址"),
                field("city", "string", false, true, null, List.of()).label("城市"),
                field("telephone", "string", false, false, null, List.of()).label("電話"),
                field("email", "string", false, false, null, List.of()).label("電子郵件"),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號")));
        type("pet", "Pet", "Pets", "title", "optional", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("name", "string", false, true, null, List.of()).label("名字"),
                field("petType", "enum", false, true, null, List.of("cat", "dog", "bird", "hamster", "lizard", "snake", "other"))
                        .label("種類", labels("cat", "貓", "dog", "狗", "bird", "鳥", "hamster", "倉鼠", "lizard", "蜥蜴",
                                "snake", "蛇", "other", "其他")),
                field("birthDate", "datetime", false, false, null, List.of()).label("出生日期"),
                field("owner", "ref", true, false, "owner", List.of()).label("飼主"),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號"),
                field("notes", "markdown", false, false, null, List.of()).label("備註"),
                field("photo", "media-ref", false, false, null, List.of(), true).label("照片")));
        type("vet", "Vet", "Vets", "title", "optional", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("firstName", "string", false, true, null, List.of()).label("名"),
                field("lastName", "string", false, true, null, List.of()).label("姓"),
                field("specialty", "enum", false, true, null, List.of("general", "radiology", "surgery", "dentistry"))
                        .label("專長", labels("general", "一般", "radiology", "放射科", "surgery", "外科", "dentistry", "牙科")),
                field("bio", "markdown", false, false, null, List.of()).label("簡介"),
                field("photo", "media-ref", false, false, null, List.of(), true).label("照片")));
        type("visit", "Visit", "Visits", "title", "none", false, List.of(), null, null, "ownerPrincipalId", List.of(
                field("title", "string", false, true, null, List.of()).label("標題"),
                field("pet", "ref", true, false, "pet", List.of()).label("寵物"),
                field("owner", "ref", false, false, "owner", List.of()).label("飼主"),
                field("vet", "ref", false, false, "vet", List.of()).label("獸醫"),
                field("scheduledAt", "datetime", false, true, null, List.of()).label("預約時間"),
                field("description", "string", false, false, null, List.of()).label("說明"),
                field("visitKind", "enum", false, true, null, List.of("checkup", "vaccine", "surgery", "other"))
                        .label("類別", labels("checkup", "健康檢查", "vaccine", "疫苗", "surgery", "手術", "other", "其他")),
                field("ownerPrincipalId", "principal-ref", false, true, null, List.of()).label("會員帳號")));
        type("project", "Project", "Projects", "title", "required", false, List.of(), null, "visibility", null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("summary", "markdown", false, false, null, List.of()).label("摘要"),
                field("cover", "media-ref", false, false, null, List.of(), true).label("封面"),
                field("visibility", "enum", false, true, null, List.of("public", "private"))
                        .label("可見性", labels("public", "公開", "private", "不公開")),
                field("lifecycle", "enum", false, true, null, List.of("active", "completed"))
                        .label("階段", labels("active", "進行中", "completed", "已完成"))));
        type("issue", "Issue", "Issues", "title", "optional", false, List.of(), null, null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("project", "ref", true, false, "project", List.of()).label("專案"),
                field("milestone", "ref", false, false, "milestone", List.of()).label("里程碑"),
                field("body", "markdown", false, false, null, List.of()).label("內容"),
                field("status", "enum", true, true, null, List.of("backlog", "ready", "in_progress", "in_review", "done"))
                        .label("狀態", labels("backlog", "待辦", "ready", "就緒", "in_progress", "進行中",
                                "in_review", "審查中", "done", "完成")),
                field("assigneePrincipalId", "string", false, true, null, List.of()).label("負責人"),
                field("sortOrder", "int", false, true, null, List.of()).label("排序")));
        type("milestone", "Milestone", "Milestones", "title", "required", false, List.of("project"), "sortOrder", null, null, List.of(
                field("title", "string", true, true, null, List.of()).label("標題"),
                field("project", "ref", true, false, "project", List.of()).label("專案"),
                field("description", "markdown", false, false, null, List.of()).label("說明"),
                field("dueDate", "datetime", false, false, null, List.of()).label("到期日"),
                field("status", "enum", false, true, null, List.of("planned", "reached", "missed"))
                        .label("狀態", labels("planned", "已規劃", "reached", "已達成", "missed", "未達成")),
                field("sortOrder", "int", false, true, null, List.of()).label("排序")));
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
            String sortField,
            String visibilityField,
            String ownerField,
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
        if (type.sortField() == null && type.visibilityField() == null && type.ownerField() == null
                && (sortField != null || visibilityField != null || ownerField != null)) {
            store.updateTypeSettings(type.withSettings(sortField, visibilityField, ownerField, now));
        }
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
        Map<String, FieldSpec> specs = fields.stream().collect(Collectors.toMap(FieldSpec::key, s -> s));
        for (FieldRecord field : store.fieldsOf(type.id())) {
            FieldSpec spec = specs.get(field.fieldKey());
            if (spec == null || spec.label == null || field.label() != null) {
                continue;
            }
            store.updateFieldMetadata(field.withMetadata(
                    spec.label,
                    group(field, sortField, visibilityField),
                    field.fieldKey().equals(titleField) || "enum".equals(field.fieldType()) || "datetime".equals(field.fieldType()),
                    field.indexed() && ("enum".equals(field.fieldType()) || "datetime".equals(field.fieldType())),
                    spec.enumLabels,
                    null,
                    null));
        }
    }

    /** media-ref → media; ref and principal-ref → relations; the type's sortField or visibilityField → settings; else main. */
    static String group(FieldRecord field, String sortField, String visibilityField) {
        return switch (field.fieldType()) {
            case "media-ref" -> "media";
            case "ref", "principal-ref" -> "relations";
            default -> field.fieldKey().equals(sortField) || field.fieldKey().equals(visibilityField) ? "settings" : "main";
        };
    }

    private static Map<String, String> labels(String... pairs) {
        Map<String, String> labels = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            labels.put(pairs[i], pairs[i + 1]);
        }
        return labels;
    }

    private static FieldSpec field(String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums) {
        return field(key, type, required, indexed, refTarget, enums, false);
    }

    private static FieldSpec field(
            String key, String type, boolean required, boolean indexed, String refTarget, List<String> enums, boolean publicBytes) {
        return new FieldSpec(key, type, required, indexed, refTarget, enums, publicBytes, null, Map.of());
    }

    private record FieldSpec(
            String key,
            String type,
            boolean required,
            boolean indexed,
            String refTarget,
            List<String> enums,
            boolean publicBytes,
            String label,
            Map<String, String> enumLabels) {

        FieldSpec label(String label) {
            return label(label, Map.of());
        }

        FieldSpec label(String label, Map<String, String> enumLabels) {
            return new FieldSpec(key, type, required, indexed, refTarget, enums, publicBytes, label, enumLabels);
        }
    }
}
