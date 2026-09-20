package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.media.service.MediaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Component
@Order(200)
public class DemoContentSeed {

    private static final Logger log = LoggerFactory.getLogger(DemoContentSeed.class);

    private final ContentStore store;
    private final EntryService entries;
    private final MediaService media;
    private final IdentityStore identity;

    public DemoContentSeed(ContentStore store, EntryService entries, MediaService media, IdentityStore identity) {
        this.store = store;
        this.entries = entries;
        this.media = media;
        this.identity = identity;
    }

    @Order(200)
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        seed();
    }

    public void seed() {
        if (identity.findPrincipalByUsername("seed-operator-album").isEmpty()) {
            return;
        }
        try {
            seedAlbum();
            seedClinic();
            seedProjects();
        } catch (Exception e) {
            throw new IllegalStateException("Demo content seed failed", e);
        }
    }

    private void seedAlbum() throws IOException {
        if (exists("album", "coast-light-2026")) {
            return;
        }
        Principal operator = requireUser("seed-operator-album");
        String harbour = upload(operator, "harbour.png", "Harbour wall", 0x2b6cb0);
        String sun = upload(operator, "late-sun.png", "Late sun", 0xd69e2e);
        String concrete = upload(operator, "concrete.png", "Concrete edge", 0x4a5568);
        String salt = upload(operator, "salt.png", "Salt air", 0x319795);
        String window = upload(operator, "window.png", "Window light", 0xed8936);
        String ferry = upload(operator, "ferry.png", "Last ferry", 0x2c5282);
        String polaroid = upload(operator, "polaroid.png", "Polaroid test", 0x744210);
        String softbox = upload(operator, "softbox.png", "Softbox", 0x1a202c);

        EntryRecord coast = create(
                operator,
                "album",
                "coast-light-2026",
                payload(
                        "title", "Coast Light 2026",
                        "description", "Sea and concrete.",
                        "visibility", "public",
                        "sortMode", "manual",
                        "cover", harbour),
                true);
        photo(operator, "coast-harbour", coast.id(), harbour, "Harbour wall", "Tide against the harbour wall.", 10, true);
        photo(operator, "coast-sun", coast.id(), sun, "Late sun", "Late sun on the flats.", 20, true);
        photo(operator, "coast-concrete", coast.id(), concrete, "Concrete edge", "A concrete edge catching spray.", 30, true);
        photo(operator, "coast-salt", coast.id(), salt, "Salt air", null, 40, true);
        photo(operator, "coast-window", coast.id(), window, "Window light", null, 50, true);
        photo(operator, "coast-ferry", coast.id(), ferry, "Last ferry", null, 60, true);

        EntryRecord studio = create(
                operator,
                "album",
                "private-studio",
                payload("title", "Studio (unpublished)", "visibility", "public", "sortMode", "manual"),
                false);
        photo(operator, "studio-polaroid", studio.id(), polaroid, "Polaroid test", "Not for the wall yet.", 10, false);
        photo(operator, "studio-softbox", studio.id(), softbox, "Softbox", null, 20, false);

        create(
                operator,
                "album",
                "unlisted-proof",
                payload("title", "Unlisted proof", "visibility", "unlisted", "sortMode", "manual"),
                true);
        log.info("Seeded album demo pack");
    }

    private void seedClinic() {
        if (exists("clinic_profile", "home")) {
            return;
        }
        Principal operator = requireUser("seed-operator-clinic");
        Principal member = requireUser("seed-member-clinic");
        create(
                operator,
                "clinic_profile",
                "home",
                payload(
                        "name", "Cedar Pet Clinic",
                        "intro", "A small neighbourhood clinic for well animals.",
                        "address", "14 Cedar Street",
                        "telephone", "6085553000",
                        "hours", "Mon–Fri 08:00–17:00"),
                true);
        EntryRecord carter = create(
                operator,
                "vet",
                "james-carter",
                payload("title", "James Carter", "firstName", "James", "lastName", "Carter", "specialty", "radiology", "bio", "Imaging."),
                true);
        create(
                operator,
                "vet",
                "helen-leary",
                payload("title", "Helen Leary", "firstName", "Helen", "lastName", "Leary", "specialty", "dentistry", "bio", "Teeth."),
                true);
        create(
                operator,
                "vet",
                "linda-douglas",
                payload("title", "Linda Douglas", "firstName", "Linda", "lastName", "Douglas", "specialty", "surgery", "bio", "Draft surgeon."),
                false);
        EntryRecord franklin = create(
                operator,
                "owner",
                "george-franklin",
                payload(
                        "title", "George Franklin",
                        "firstName", "George",
                        "lastName", "Franklin",
                        "city", "Madison",
                        "telephone", "6085551023",
                        "ownerPrincipalId", member.id().toString()),
                true);
        EntryRecord davis = create(
                operator,
                "owner",
                "betty-davis",
                payload("title", "Betty Davis", "firstName", "Betty", "lastName", "Davis", "city", "Madison"),
                true);
        EntryRecord rodriquez = create(
                operator,
                "owner",
                "eduardo-rodriquez",
                payload("title", "Eduardo Rodriquez", "firstName", "Eduardo", "lastName", "Rodriquez", "city", "McFarland"),
                true);
        EntryRecord leo = create(
                operator,
                "pet",
                "leo",
                payload(
                        "title", "Leo",
                        "name", "Leo",
                        "petType", "cat",
                        "owner", franklin.id().toString(),
                        "ownerPrincipalId", member.id().toString()),
                true);
        create(
                operator,
                "pet",
                "basil",
                payload("title", "Basil", "name", "Basil", "petType", "hamster", "owner", davis.id().toString()),
                true);
        create(
                operator,
                "pet",
                "jewel",
                payload("title", "Jewel", "name", "Jewel", "petType", "dog", "owner", rodriquez.id().toString()),
                true);
        create(
                operator,
                "visit",
                "leo-rabies",
                payload(
                        "title", "Leo rabies shot",
                        "pet", leo.id().toString(),
                        "owner", franklin.id().toString(),
                        "vet", carter.id().toString(),
                        "scheduledAt", "2026-03-01T10:00:00Z",
                        "description", "rabies shot",
                        "visitKind", "vaccine",
                        "ownerPrincipalId", member.id().toString()),
                true);
        create(
                operator,
                "visit",
                "leo-checkup",
                payload(
                        "title", "Leo checkup",
                        "pet", leo.id().toString(),
                        "owner", franklin.id().toString(),
                        "vet", carter.id().toString(),
                        "scheduledAt", "2026-09-20T09:00:00Z",
                        "description", "annual checkup",
                        "visitKind", "checkup",
                        "ownerPrincipalId", member.id().toString()),
                false);
        log.info("Seeded petclinic demo pack");
    }

    private void seedProjects() {
        if (exists("project", "cms-scaffold")) {
            return;
        }
        Principal operator = requireUser("seed-operator-projects");
        EntryRecord scaffold = create(
                operator,
                "project",
                "cms-scaffold",
                payload(
                        "title", "CMS Scaffold",
                        "summary", "Reusable CMS kernel with three surfaces.",
                        "visibility", "public",
                        "lifecycle", "active"),
                true);
        create(
                operator,
                "project",
                "internal-ops",
                payload("title", "Internal Ops", "summary", "Not for the public site.", "visibility", "private", "lifecycle", "active"),
                true);
        create(
                operator,
                "project",
                "draft-lab",
                payload("title", "Draft Lab", "summary", "Still a draft.", "visibility", "public", "lifecycle", "active"),
                false);
        EntryRecord m1 = create(
                operator,
                "milestone",
                "m1-specs",
                payload("title", "M1 Specs", "project", scaffold.id().toString(), "status", "planned", "sortOrder", 10),
                true);
        create(
                operator,
                "milestone",
                "m2-kernel",
                payload("title", "M2 Kernel", "project", scaffold.id().toString(), "status", "planned", "sortOrder", 20),
                true);
        create(
                operator,
                "milestone",
                "m3-surfaces",
                payload("title", "M3 Surfaces", "project", scaffold.id().toString(), "status", "planned", "sortOrder", 30),
                true);
        create(
                operator,
                "issue",
                "write-album-pack",
                payload(
                        "title", "Write album pack",
                        "project", scaffold.id().toString(),
                        "milestone", m1.id().toString(),
                        "status", "done",
                        "sortOrder", 10),
                false);
        create(
                operator,
                "issue",
                "visit-timeline-query",
                payload("title", "Visit timeline query", "project", scaffold.id().toString(), "status", "in_progress", "sortOrder", 20),
                false);
        create(
                operator,
                "issue",
                "kanban-dnd",
                payload("title", "Kanban DnD", "project", scaffold.id().toString(), "status", "ready", "sortOrder", 30),
                false);
        create(
                operator,
                "issue",
                "private-project-leak-test",
                payload("title", "Private project leak test", "project", scaffold.id().toString(), "status", "backlog", "sortOrder", 40),
                false);
        EntryRecord ops = store.findTypeByKey("project")
                .flatMap(type -> store.findBySlug(type.id(), "internal-ops"))
                .orElseThrow();
        create(
                operator,
                "issue",
                "secret-infra-task",
                payload("title", "Secret infra task", "project", ops.id().toString(), "status", "backlog", "sortOrder", 10),
                false);
        log.info("Seeded projects demo pack");
    }

    private void photo(
            Principal operator,
            String slug,
            UUID albumId,
            String mediaId,
            String title,
            String caption,
            int sortOrder,
            boolean publish) {
        Map<String, Object> body = payload("title", title, "album", albumId.toString(), "media", mediaId, "sortOrder", sortOrder);
        if (caption != null) {
            body.put("caption", caption);
        }
        create(operator, "photo", slug, body, publish);
    }

    private EntryRecord create(Principal actor, String type, String slug, Map<String, Object> payload, boolean publish) {
        EntryRecord entry = entries.create(actor, Surface.BACK, type, slug, payload);
        if (publish) {
            return entries.publish(actor, Surface.BACK, entry.id());
        }
        return entry;
    }

    private String upload(Principal actor, String filename, String title, int rgb) throws IOException {
        return media.upload(actor, Surface.BACK, png(rgb, title), filename, title, title).id().toString();
    }

    private Principal requireUser(String username) {
        return identity.findPrincipalByUsername(username)
                .orElseThrow(() -> new IllegalStateException("Missing seed user " + username));
    }

    private boolean exists(String typeKey, String slug) {
        return store.findTypeByKey(typeKey).flatMap(type -> store.findBySlug(type.id(), slug)).isPresent();
    }

    private static Map<String, Object> payload(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put(String.valueOf(pairs[i]), pairs[i + 1]);
        }
        return map;
    }

    private static byte[] png(int rgb, String label) throws IOException {
        BufferedImage image = new BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(new Color(rgb));
        graphics.fillRect(0, 0, 64, 64);
        graphics.setColor(Color.WHITE);
        graphics.drawString(label == null ? "" : label.substring(0, Math.min(label.length(), 8)), 6, 36);
        graphics.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", out)) {
            throw new IOException("Unable to encode PNG fixture");
        }
        return out.toByteArray();
    }
}
