package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.Map;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.web.IdentityRequest;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import static org.assertj.core.api.Assertions.assertThat;

/** surface-admin §7.2: the purge deletes events older than the retention; a shorter retention applies at the next run. */
class AuditRetentionServiceTests {

    static final Instant NOW = Instant.parse("2026-09-25T03:00:00Z");

    @Test
    void BW4_purgeDeletesEventsOlderThanTheRetention() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        ObjectMapper mapper = new ObjectMapper();
        AuditRetentionService service = new AuditRetentionService(store, new AuthorizationService(store, mapper),
                TransactionRunner.withoutDatabase(), new AuditLog(store, mapper), Clock.fixed(NOW, ZoneOffset.UTC));
        AuditEvent days100 = event(NOW.minus(Duration.ofDays(100)));
        AuditEvent days90 = event(NOW.minus(Duration.ofDays(90)));
        AuditEvent days40 = event(NOW.minus(Duration.ofDays(40)));
        AuditEvent days10 = event(NOW.minus(Duration.ofDays(10)));
        List.of(days100, days90, days40, days10).forEach(store::insertAudit);

        assertThat(service.purgeExpired()).isEqualTo(1);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id)
                .containsExactly(days10.id(), days40.id(), days90.id());

        store.updateAuditRetention(new AuditRetention(30, NOW, null));
        assertThat(service.purgeExpired()).isEqualTo(2);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id).containsExactly(days10.id());

        store.updateAuditRetention(new AuditRetention(365, NOW, null));
        assertThat(service.purgeExpired()).isZero();
    }

    @Test
    void BW4_updateUsesTheClockAuditsOnceAndDefersDeletionUntilPurge() throws Exception {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        ObjectMapper mapper = new ObjectMapper();
        AuditRetentionService service = new AuditRetentionService(store, mock(AuthorizationService.class),
                TransactionRunner.withoutDatabase(), new AuditLog(store, mapper), Clock.fixed(NOW, ZoneOffset.UTC));
        IdentityRequest request = new IdentityRequest();
        Principal actor = new Principal(UUID.randomUUID(), "admin", "Admin", null, PrincipalStatus.ACTIVE,
                0, null, null, NOW, NOW, null);
        request.setPrincipal(actor);
        request.setSurface(Surface.ADMIN);
        AuditEvent old = event(NOW.minus(Duration.ofDays(40)));
        store.insertAudit(old);
        Map<String, Object> result = service.update(request, Map.of("retentionDays", 30));
        assertThat(result).containsEntry("retentionDays", 30).containsEntry("updatedAt", NOW)
                .containsEntry("updatedBy", actor.id().toString());
        assertThat(store.findAudit(old.id())).isPresent();
        List<AuditEvent> events = store.listAudits("settings.retention_updated", null);
        assertThat(events).hasSize(1);
        AuditEvent event = events.getFirst();
        assertThat(event.actorPrincipalId()).isEqualTo(actor.id());
        assertThat(event.category()).isEqualTo("SETTINGS");
        assertThat(event.targetType()).isEqualTo("settings");
        assertThat(event.targetId()).isNull();
        assertThat(event.surface()).isEqualTo("admin");
        assertThat(event.outcome()).isEqualTo("ok");
        assertThat(mapper.readTree(event.detailJson())).isEqualTo(mapper.readTree("{\"from\":90,\"to\":30}"));
        assertThat(service.update(request, Map.of("retentionDays", 30))).isEqualTo(result);
        assertThat(store.listAudits("settings.retention_updated", null)).containsExactly(event);
        assertThat(service.purgeExpired()).isEqualTo(1);
        assertThat(store.findAudit(old.id())).isEmpty();
        assertThat(store.listAudits("settings.retention_updated", null)).containsExactly(event);
    }

    @Test
    void BW4_domainRejectsUnsupportedRetention() {
        for (int days : List.of(-1, 0, 29, 31, 45, 89, 91, 364, 366)) {
            assertThatThrownBy(() -> new AuditRetention(days, NOW, null)).isInstanceOf(IllegalArgumentException.class);
        }
        for (int days : AuditRetention.ALLOWED_DAYS) {
            assertThat(new AuditRetention(days, NOW, null).days()).isEqualTo(days);
        }
    }

    private static AuditEvent event(Instant at) {
        return new AuditEvent(UUID.randomUUID(), at, null, "AUTH", "LOGIN_SUCCESS", "principal", UUID.randomUUID(), "admin",
                "ok", null, null);
    }
}
