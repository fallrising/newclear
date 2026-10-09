package com.fallrising.cms.identity.maintenance;

import java.util.UUID;

public interface MaintenanceGuard {
    ConnectionPhase connectionPhase();
    interface ConnectionPhase {
        void assertPreConnection();
        void bindBackend(int pid, String backendStartEpoch);
        void assertBound();
    }
    Lease acquire(String targetId, UUID operationId, IdentityMaintenanceCommand.Operation operation);
    interface Lease extends AutoCloseable {
        String targetId();
        String releaseId();
        String backupId();
        void assertQuiesced();
        void recordCommitted(IdentityMaintenanceCommand.Result result);
        @Override void close();
    }

    static MaintenanceGuard defaultDeny() {
        return new MaintenanceGuard() {
            private IdentityMaintenanceCommand.Failure denied() {
                return new IdentityMaintenanceCommand.Failure(
                        IdentityMaintenanceCommand.FailureCode.HOST_GUARD_NOT_CONFIGURED);
            }
            @Override public ConnectionPhase connectionPhase() { throw denied(); }
            @Override public Lease acquire(String targetId, UUID operationId, IdentityMaintenanceCommand.Operation operation) {
                throw denied();
            }
        };
    }
}
