package com.fallrising.cms.identity.service;

import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.platform.TransactionRunner;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Audit retention (surface-admin §7.2, 02 BQ-03). GET and PATCH /admin/settings/audit need manage_settings (Admin
 * surface only, by the hard-deny sets). A change writes settings.retention_updated with detail {from, to} in the same
 * transaction; setting the current value again changes nothing and writes no event. purgeExpired deletes events older
 * than the retention; AuditPurgeJob calls it on a schedule, so a shorter retention applies at the next run.
 */
@Service
public class AuditRetentionService {

    private final IdentityStore store;
    private final AuthorizationService authorization;
    private final TransactionRunner transactions;
    private final AuditLog audit;
    private final Clock clock;

    @Autowired
    public AuditRetentionService(IdentityStore store, AuthorizationService authorization, TransactionRunner transactions,
            AuditLog audit) {
        this(store, authorization, transactions, audit, Clock.systemUTC());
    }

    AuditRetentionService(IdentityStore store, AuthorizationService authorization, TransactionRunner transactions,
            AuditLog audit, Clock clock) {
        this.store = store;
        this.authorization = authorization;
        this.transactions = transactions;
        this.audit = audit;
        this.clock = clock;
    }

    public Map<String, Object> get(IdentityRequest request) {
        authorization.require(request.principal(), CmsAction.MANAGE_SETTINGS, null, null, request.surface());
        return json(store.auditRetention());
    }

    /** body is the parsed JSON object; only retentionDays is allowed. */
    public Map<String, Object> update(IdentityRequest request, Map<String, Object> body) {
        authorization.require(request.principal(), CmsAction.MANAGE_SETTINGS, null, null, request.surface());
        for (String key : body.keySet()) {
            if (!key.equals("retentionDays")) throw IdentityException.validation("Unknown property " + key);
        }
        Object raw = body.get("retentionDays");
        if (raw == null) throw invalid(FieldErrorCode.REQUIRED, "retentionDays is required");
        if (!(raw instanceof Integer days)) throw invalid(FieldErrorCode.WRONG_TYPE, "retentionDays must be an integer");
        if (!AuditRetention.ALLOWED_DAYS.contains(days)) {
            throw invalid(FieldErrorCode.NOT_IN_ENUM, "retentionDays must be one of " + AuditRetention.ALLOWED_DAYS);
        }
        return transactions.inTransaction(() -> {
            AuditRetention current = store.auditRetention();
            if (current.days() == days) return json(current);
            AuditRetention next = new AuditRetention(days, clock.instant(), request.principal().id());
            store.updateAuditRetention(next);
            audit.record(request.principal(), request.surface(), "SETTINGS", "settings.retention_updated", "settings",
                    null, AuditLog.OK, Map.of("from", current.days(), "to", days));
            return json(next);
        });
    }

    /** Deletes audit events with at before now minus the retention; returns how many. */
    public int purgeExpired() {
        return store.deleteAuditsBefore(clock.instant().minus(Duration.ofDays(store.auditRetention().days())));
    }

    private static IdentityException invalid(FieldErrorCode code, String message) {
        return IdentityException.fieldValidation(List.of(new FieldError("retentionDays", code, message)));
    }

    private static Map<String, Object> json(AuditRetention retention) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("retentionDays", retention.days());
        json.put("allowedDays", AuditRetention.ALLOWED_DAYS);
        json.put("updatedAt", retention.updatedAt());
        json.put("updatedBy", retention.updatedBy() == null ? null : retention.updatedBy().toString());
        return json;
    }
}
