package dev.ojbk.console.group;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import dev.ojbk.console.api.ApiException;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Duration;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;

final class GroupMaintenanceFenceAc09Test {
    @Test void AC_09_lostPhysicalSessionLockCannotKeepThreadOwnership() throws Exception {
        DataSource source = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet rows = mock(ResultSet.class);
        when(source.getConnection()).thenReturn(connection);
        when(connection.prepareStatement(anyString())).thenReturn(statement);
        when(statement.executeQuery()).thenReturn(rows);
        when(rows.next()).thenReturn(true);
        when(rows.getBoolean(1)).thenReturn(true, false, false);
        when(statement.executeUpdate()).thenReturn(1);
        var fence = new GroupMaintenanceFence(source, mock(JdbcClient.class, org.mockito.Mockito.RETURNS_DEEP_STUBS));
        try (var gate = fence.acquire(1, System.nanoTime() + Duration.ofSeconds(1).toNanos())) {
            assertThatThrownBy(gate::verifyOwned).isInstanceOf(ApiException.class);
            assertThatThrownBy(() -> fence.mutation(1)).isInstanceOf(ApiException.class);
        }
    }
}
