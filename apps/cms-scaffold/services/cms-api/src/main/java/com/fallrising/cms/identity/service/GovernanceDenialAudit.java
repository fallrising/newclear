package com.fallrising.cms.identity.service;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.platform.TransactionRunner;
import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/** Records only approved business denials after the attempted mutation's transaction exits. */
@Component
public class GovernanceDenialAudit {
    private final TransactionRunner transactions;
    private final AuditLog audit;

    public GovernanceDenialAudit(TransactionRunner transactions, AuditLog audit) {
        this.transactions = transactions;
        this.audit = audit;
    }

    public <T> T execute(Principal actor, Surface surface, String category, String action,
            String targetType, UUID targetId, Supplier<T> attempt) {
        try {
            return attempt.get();
        } catch (CmsApiException failure) {
            if (actor != null && allowed(category, action, targetType).contains(failure.code())) {
                transactions.independently(() -> audit.record(actor, surface, category, action, targetType,
                        targetId, AuditLog.DENIED, Map.of("reason", failure.code().wire())));
            }
            throw failure;
        }
    }

    private static Set<ErrorCode> allowed(String category, String action, String targetType) {
        return switch (category + "/" + targetType + "/" + action) {
            case "AUTH/principal/PRINCIPAL_DISABLED" -> Set.of(ErrorCode.SELF_DISABLE_FORBIDDEN, ErrorCode.LAST_ADMIN);
            case "AUTH/principal/ROLE_ASSIGNED" -> Set.of(ErrorCode.SELF_DEMOTION_FORBIDDEN, ErrorCode.LAST_ADMIN);
            case "AUTH/role/role.permissions_update" -> Set.of(ErrorCode.LAST_ADMIN);
            case "CONTENT/entry/entry.purge" -> Set.of(ErrorCode.SURFACE_FORBIDDEN, ErrorCode.FORBIDDEN,
                    ErrorCode.CONFIRMATION_REQUIRED, ErrorCode.REF_CONSTRAINT, ErrorCode.VERSION_CONFLICT);
            default -> Set.of();
        };
    }
}
