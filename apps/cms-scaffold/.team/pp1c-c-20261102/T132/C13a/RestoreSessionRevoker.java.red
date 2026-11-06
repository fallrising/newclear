package com.fallrising.cms.ops;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

/** Fixed offline restored-session transaction; never opens another connection. */
public final class RestoreSessionRevoker {
    private RestoreSessionRevoker() {}

    public static Map<String, Object> revoke(Connection connection, UUID operationId,
                                              String backupId, String targetRef) throws Exception {
        throw new SQLException("SESSION_REVOKE_FAILED");
    }
}
