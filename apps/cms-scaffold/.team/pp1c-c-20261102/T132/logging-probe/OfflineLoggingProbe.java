import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.slf4j.LoggerFactory;
public class OfflineLoggingProbe {
    public static void main(String[] args) {
        System.out.println("jdbcDebug=" + LoggerFactory.getLogger(JdbcTemplate.class).isDebugEnabled());
        try { new JdbcTemplate(new DriverManagerDataSource("jdbc:unsupported:probe")).execute("SELECT 'offline-SQL-canary'"); }
        catch (Exception expected) { System.out.println("probeFinished"); }
    }
}
