package com.fallrising.cms.identity.maintenance;

import com.fallrising.cms.content.service.ContentTypeSeed;
import com.fallrising.cms.content.service.DemoContentSeed;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.service.SeedService;
import com.fallrising.cms.identity.service.DemoSeedPolicy;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.media.service.MediaService;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.env.MockEnvironment;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class ProductionSeedSeparationTests {
    @ParameterizedTest
    @CsvSource({"prod,true", "prod,false", "dev,false"})
    void PP1aFM02_prodDisablesAllDemoWriters(String profile, boolean enabled) {
        var environment = new MockEnvironment();
        environment.setActiveProfiles(profile);
        var properties = new IdentityProperties();
        properties.setSeedEnabled(enabled);
        properties.setSeedPassword("explicit-unit-test-secret");
        var identity = new InMemoryIdentityStore();
        var hasher = mock(PasswordHasher.class);
        var policy = new DemoSeedPolicy(properties, environment);
        new SeedService(identity, hasher, properties, policy).seed();
        assertThat(identity.listRoles()).hasSize(5);
        assertThat(identity.listPrincipals()).isEmpty();
        assertThat(identity.listRoles()).allSatisfy(role -> assertThat(identity.permissionsOfRole(role.id())).isEmpty());
        verifyNoInteractions(hasher);
        var content = new InMemoryContentStore();
        new ContentTypeSeed(content, policy).seed();
        assertThat(content.listTypes()).hasSize(12);
        assertThat(content.findNavigation("front.primary")).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({"prod,true,true", "prod,false,true", "dev,false,true", "prod,false,false"})
    void PP1aFM02_directDemoCallDoesNotEvenInspectOldSentinel(String profile, boolean enabled, boolean oldActor) {
        var identity = mock(com.fallrising.cms.identity.store.IdentityStore.class);
        Instant now = Instant.now();
        var actor = new Principal(UUID.randomUUID(), "seed-operator-album", "Old actor", null, PrincipalStatus.ACTIVE,
                0, null, null, now, now, null);
        when(identity.findPrincipalByUsername("seed-operator-album"))
                .thenReturn(oldActor ? Optional.of(actor) : Optional.empty());
        var content = mock(com.fallrising.cms.content.store.ContentStore.class);
        var entries = mock(EntryService.class);
        var media = mock(MediaService.class);
        var environment = new MockEnvironment();
        environment.setActiveProfiles(profile);
        var properties = new IdentityProperties();
        properties.setSeedEnabled(enabled);
        new DemoContentSeed(content, entries, media, identity, new DemoSeedPolicy(properties, environment)).seed();
        verifyNoInteractions(content, entries, media);
        verify(identity, never()).findPrincipalByUsername(anyString());
    }

    @Test
    void disabledSeedingKeepsExistingActorCredentialRolesAndNavigation() {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        var properties = new IdentityProperties();
        properties.setSeedEnabled(true);
        var policy = new DemoSeedPolicy(properties, environment);
        var identity = new InMemoryIdentityStore();
        var hasher = mock(PasswordHasher.class);
        var seed = new SeedService(identity, hasher, properties, policy);
        seed.seed();
        Instant now = Instant.now();
        var actor = new Principal(UUID.randomUUID(), "seed-operator-album", "Retained actor", null,
                PrincipalStatus.ACTIVE, 0, null, null, now, now, null);
        identity.insertPrincipal(actor);
        identity.upsertPasswordCredential(actor.id(), "retained-hash", "argon2id");
        var roles = identity.listRoles();
        var credential = identity.findPasswordCredential(actor.id());
        seed.seed();
        assertThat(identity.listPrincipals()).containsExactly(actor);
        assertThat(identity.listRoles()).isEqualTo(roles);
        assertThat(identity.findPasswordCredential(actor.id())).isEqualTo(credential);
        verifyNoInteractions(hasher);
        var content = new InMemoryContentStore();
        var navigation = new NavigationRecord(UUID.randomUUID(), "front.primary", "front", "draft", 9,
                Map.of("items", List.of()), null, actor.id(), now);
        content.upsertNavigation(navigation);
        new ContentTypeSeed(content, policy).seed();
        assertThat(content.findNavigation("front.primary")).contains(navigation);
        assertThat(content.listTypes()).hasSize(12);
    }

    @Test
    void developmentStillSeedsPrincipalsGrantsNavigationAndChecksExistingDemoSentinels() {
        var properties = new IdentityProperties();
        properties.setSeedPassword("explicit-unit-test-secret");
        var policy = new DemoSeedPolicy(properties, new MockEnvironment());
        var identity = new InMemoryIdentityStore();
        var hasher = mock(PasswordHasher.class);
        when(hasher.hash(anyString())).thenReturn("test-only-hash");
        when(hasher.algo()).thenReturn("argon2id");
        new SeedService(identity, hasher, properties, policy).seed();
        assertThat(identity.listPrincipals()).hasSize(9);
        assertThat(identity.permissionsOfRole(identity.findRoleByCode("anonymous").orElseThrow().id())).isNotEmpty();
        var catalog = new InMemoryContentStore();
        new ContentTypeSeed(catalog, policy).seed();
        assertThat(catalog.listTypes()).hasSize(12);
        assertThat(catalog.findNavigation("front.primary")).isPresent();
        var content = mock(com.fallrising.cms.content.store.ContentStore.class);
        var type = mock(ContentTypeRecord.class);
        UUID typeId = UUID.randomUUID();
        when(type.id()).thenReturn(typeId);
        when(content.findTypeByKey(anyString())).thenReturn(Optional.of(type));
        when(content.findBySlug(eq(typeId), anyString())).thenReturn(Optional.of(mock(EntryRecord.class)));
        var entries = mock(EntryService.class);
        var media = mock(MediaService.class);
        new DemoContentSeed(content, entries, media, identity, policy).seed();
        verify(content).findBySlug(typeId, "coast-light-2026");
        verify(content).findBySlug(typeId, "home");
        verify(content).findBySlug(typeId, "cms-scaffold");
        verifyNoInteractions(entries, media);
    }
}
