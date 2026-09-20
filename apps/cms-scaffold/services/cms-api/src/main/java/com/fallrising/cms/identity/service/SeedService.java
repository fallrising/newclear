package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
@Order(0)
public class SeedService {

    private static final Logger log = LoggerFactory.getLogger(SeedService.class);
    private static final List<String> PUBLIC_READ =
            List.of("album", "photo", "page", "project", "milestone", "vet", "clinic_profile");
    private static final List<String> ALL_SURFACES = List.of(Surface.FRONT.wire(), Surface.BACK.wire(), Surface.ADMIN.wire());
    private static final List<String> WORK_SURFACES = List.of(Surface.BACK.wire(), Surface.ADMIN.wire());
    private static final List<String> ADMIN_SURFACES = List.of(Surface.ADMIN.wire());

    private final IdentityStore store;
    private final PasswordHasher passwordHasher;
    private final IdentityProperties properties;
    private final Environment environment;

    public SeedService(IdentityStore store, PasswordHasher passwordHasher, IdentityProperties properties, Environment environment) {
        this.store = store;
        this.passwordHasher = passwordHasher;
        this.properties = properties;
        this.environment = environment;
    }

    @Order(0)
    @EventListener(ApplicationReadyEvent.class)
    public void onReady() { seed(); }

    public void seed() {
        boolean prod = List.of(environment.getActiveProfiles()).contains("prod");
        if (prod && !properties.isSeedEnabled()) { ensureRoles(); return; }
        if (prod && properties.isSeedEnabled() && properties.seedPasswordFor("seed-admin") == null) {
            throw new IllegalStateException("CMS_SEED_ENABLED requires CMS_SEED_PASSWORD or per-user seed password in prod");
        }
        if (!properties.isSeedEnabled()) { ensureRoles(); return; }
        ensureRoles();
        ensurePermissions();
        Map<String, String> generated = new LinkedHashMap<>();
        seedUser("seed-admin", "Platform admin", RoleCode.ADMIN, List.of(), generated);
        seedUser("seed-editor-album", "Album editor", RoleCode.EDITOR, List.of("album", "photo"), generated);
        seedUser("seed-operator-album", "Album operator", RoleCode.OPERATOR, List.of("album", "photo"), generated);
        seedUser("seed-member-clinic", "Clinic member", RoleCode.MEMBER, List.of(), generated);
        seedUser("seed-editor-clinic", "Clinic editor", RoleCode.EDITOR, List.of("clinic_profile", "vet"), generated);
        seedUser("seed-operator-clinic", "Clinic operator", RoleCode.OPERATOR, List.of("clinic_profile", "owner", "pet", "vet", "visit"), generated);
        seedUser("seed-editor-projects", "Projects editor", RoleCode.EDITOR, List.of("project", "milestone"), generated);
        seedUser("seed-operator-projects", "Projects operator", RoleCode.OPERATOR, List.of("project", "issue", "milestone"), generated);
        seedUser("seed-member-projects", "Projects member", RoleCode.MEMBER, List.of(), generated);
        if (!generated.isEmpty()) writeGeneratedPasswords(generated);
    }

    private void ensureRoles() {
        Instant now = Instant.now();
        insertRole(RoleCode.ANONYMOUS, "Anonymous", now);
        insertRole(RoleCode.MEMBER, "Member", now);
        insertRole(RoleCode.EDITOR, "Editor", now);
        insertRole(RoleCode.OPERATOR, "Operator", now);
        insertRole(RoleCode.ADMIN, "Admin", now);
    }

    private void insertRole(RoleCode code, String display, Instant now) {
        if (store.findRoleByCode(code.wire()).isPresent()) return;
        store.insertRole(new Role(UUID.randomUUID(), code.wire(), display, true, now));
    }

    private void ensurePermissions() {
        Role anonymous = role(RoleCode.ANONYMOUS);
        Role member = role(RoleCode.MEMBER);
        Role editor = role(RoleCode.EDITOR);
        Role operator = role(RoleCode.OPERATOR);
        Role admin = role(RoleCode.ADMIN);
        for (String type : PUBLIC_READ) {
            ensurePermission(anonymous.id(), CmsAction.READ_PUBLISHED, type, null, ALL_SURFACES);
            ensurePermission(member.id(), CmsAction.READ_PUBLISHED, type, null, ALL_SURFACES);
        }
        String predicate = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "pet", predicate, ALL_SURFACES);
        ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "visit", predicate, ALL_SURFACES);
        ensurePermission(member.id(), CmsAction.READ_PUBLISHED, "owner", predicate, ALL_SURFACES);
        if (store.permissionsOfRole(editor.id()).isEmpty()) {
            addPermission(editor.id(), CmsAction.READ_PUBLISHED, null, null, ALL_SURFACES);
            addPermission(editor.id(), CmsAction.READ_DRAFT, null, null, WORK_SURFACES);
            addPermission(editor.id(), CmsAction.CREATE, null, null, WORK_SURFACES);
            addPermission(editor.id(), CmsAction.UPDATE, null, null, WORK_SURFACES);
            addPermission(editor.id(), CmsAction.MANAGE_MEDIA, null, null, WORK_SURFACES);
        }
        if (store.permissionsOfRole(operator.id()).isEmpty()) {
            addPermission(operator.id(), CmsAction.READ_PUBLISHED, null, null, ALL_SURFACES);
            addPermission(operator.id(), CmsAction.READ_DRAFT, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.CREATE, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.UPDATE, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.PUBLISH, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.UNPUBLISH, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.DELETE, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.ARCHIVE, null, null, WORK_SURFACES);
            addPermission(operator.id(), CmsAction.MANAGE_MEDIA, null, null, WORK_SURFACES);
        }
        if (store.permissionsOfRole(admin.id()).isEmpty()) {
            for (CmsAction action : CmsAction.values()) {
                List<String> surfaces = CmsAction.GOVERNANCE.contains(action) ? ADMIN_SURFACES : action == CmsAction.READ_PUBLISHED ? ALL_SURFACES : WORK_SURFACES;
                addPermission(admin.id(), action, null, null, surfaces);
            }
        }
    }

    private void addPermission(UUID roleId, CmsAction action, String type, String predicate, List<String> surfaces) {
        store.insertPermission(new Permission(UUID.randomUUID(), roleId, action.wire(), type, predicate, surfaces, Instant.now()));
    }

    private void ensurePermission(UUID roleId, CmsAction action, String type, String predicate, List<String> surfaces) {
        boolean exists = store.permissionsOfRole(roleId).stream().anyMatch(permission ->
                permission.action().equals(action.wire())
                        && java.util.Objects.equals(blankToNull(type), blankToNull(permission.contentTypeCode()))
                        && java.util.Objects.equals(blankToNull(predicate), blankToNull(permission.predicateJson())));
        if (!exists) {
            addPermission(roleId, action, type, predicate, surfaces);
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private void seedUser(String username, String displayName, RoleCode roleCode, List<String> allowlist, Map<String, String> generated) {
        var existing = store.findPrincipalByUsername(username);
        if (existing.isPresent()) {
            Principal principal = existing.get();
            Role role = role(roleCode);
            store.replacePrincipalRoles(
                    principal.id(),
                    List.of(new PrincipalRoleAssignment(principal.id(), role.id(), role.code(), allowlist)));
            return;
        }
        String password = properties.seedPasswordFor(username);
        if (password == null) {
            password = SessionTokens.randomToken() + "-Seed";
            generated.put(username, password);
        }
        Instant now = Instant.now();
        Principal principal = new Principal(UUID.randomUUID(), username, displayName, null, PrincipalStatus.ACTIVE, 0, null, null, now, now, null);
        store.insertPrincipal(principal);
        store.upsertPasswordCredential(principal.id(), passwordHasher.hash(password), passwordHasher.algo());
        Role role = role(roleCode);
        store.replacePrincipalRoles(principal.id(), List.of(new PrincipalRoleAssignment(principal.id(), role.id(), role.code(), allowlist)));
    }

    private Role role(RoleCode code) { return store.findRoleByCode(code.wire()).orElseThrow(); }

    private void writeGeneratedPasswords(Map<String, String> generated) {
        Path dir = Path.of("local");
        Path file = dir.resolve("seed-passwords.txt");
        try {
            Files.createDirectories(dir);
            List<String> lines = new ArrayList<>();
            lines.add("# Generated seed passwords. Do not commit. Mode 0600.");
            generated.forEach((user, password) -> lines.add(user + "=" + password));
            Files.write(file, lines);
            try { Files.setPosixFilePermissions(file, EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)); }
            catch (UnsupportedOperationException ignored) { }
            log.info("Wrote generated seed passwords to {}", file.toAbsolutePath());
        } catch (IOException e) {
            throw new IllegalStateException("Unable to write seed password file " + file, e);
        }
    }
}
