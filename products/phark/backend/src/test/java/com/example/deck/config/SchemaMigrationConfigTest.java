package com.example.deck.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zaxxer.hikari.HikariDataSource;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SchemaMigrationConfigTest {

    static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @TempDir
    File tempDir;

    private String url;

    @BeforeEach
    void setUp() {
        url = "jdbc:sqlite:" + new File(tempDir, "test.db").getAbsolutePath();
    }

    private void execute(String... statements) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement()) {
            for (String sql : statements) {
                stmt.execute(sql);
            }
        }
    }

    private void runMigration() {
        runMigration(null);
    }

    private void runMigration(String target) {
        try (HikariDataSource dataSource = new HikariDataSource()) {
            dataSource.setJdbcUrl(url);
            dataSource.setDriverClassName("org.sqlite.JDBC");
            dataSource.setMaximumPoolSize(1);

            FluentConfiguration configuration = Flyway.configure()
                    .dataSource(dataSource)
                    .locations("classpath:db/migration")
                    .baselineVersion("1")
                    .validateOnMigrate(true)
                    .validateMigrationNaming(true)
                    .cleanDisabled(true);
            if (target != null) {
                configuration.target(target);
            }

            new SchemaMigrationConfig().guardedLegacyBaseline().migrate(configuration.load());
        }
    }

    private List<String[]> queryHistory() throws Exception {
        List<String[]> rows = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT version, type, script, success FROM flyway_schema_history ORDER BY installed_rank")) {
            while (rs.next()) {
                rows.add(new String[] { rs.getString("version"), rs.getString("type"),
                        rs.getString("script"), rs.getString("success") });
            }
        }
        return rows;
    }

    private boolean tableExists(String table) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='" + table + "'")) {
            return rs.next() && rs.getInt(1) > 0;
        }
    }

    private boolean indexExists(String index) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='" + index + "'")) {
            return rs.next() && rs.getInt(1) > 0;
        }
    }

    private long queryLong(String sql) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(sql)) {
            assertThat(rs.next()).isTrue();
            return rs.getLong(1);
        }
    }

    private boolean columnExists(String table, String column) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA table_info(" + table + ")")) {
            while (rs.next()) {
                if (column.equals(rs.getString("name"))) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean columnIsNullable(String table, String column) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA table_info(" + table + ")")) {
            while (rs.next()) {
                if (column.equals(rs.getString("name"))) {
                    return rs.getInt("notnull") == 0;
                }
            }
        }
        throw new AssertionError("Missing column " + table + "." + column);
    }

    private boolean fkExists(
            String childTable,
            String childColumn,
            String parentTable,
            String onDelete)
            throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "PRAGMA foreign_key_list(" + childTable + ")")) {
            while (rs.next()) {
                if (childColumn.equals(rs.getString("from"))
                        && parentTable.equals(rs.getString("table"))
                        && onDelete.equals(rs.getString("on_delete"))) {
                    return true;
                }
            }
        }
        return false;
    }

    private int primaryKeyOrder(String table, String column) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA table_info(" + table + ")")) {
            while (rs.next()) {
                if (column.equals(rs.getString("name"))) {
                    return rs.getInt("pk");
                }
            }
        }
        throw new AssertionError("Missing column " + table + "." + column);
    }

    private boolean hasUniqueIndex(String table, String... columns) throws Exception {
        List<String> uniqueIndexes = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA index_list(" + table + ")")) {
            while (rs.next()) {
                if (rs.getInt("unique") == 1) {
                    uniqueIndexes.add(rs.getString("name"));
                }
            }
        }
        for (String index : uniqueIndexes) {
            List<String> indexColumns = new ArrayList<>();
            try (Connection conn = DriverManager.getConnection(url);
                    Statement stmt = conn.createStatement();
                    ResultSet rs = stmt.executeQuery("PRAGMA index_info(" + index + ")")) {
                while (rs.next()) {
                    indexColumns.add(rs.getString("name"));
                }
            }
            if (List.of(columns).equals(indexColumns)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasIndex(String table, String... columns) throws Exception {
        List<String> target = List.of(columns);
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA index_list(" + table + ")")) {
            while (rs.next()) {
                String indexName = rs.getString("name");
                List<String> indexColumns = new ArrayList<>();
                try (Connection conn2 = DriverManager.getConnection(url);
                        Statement stmt2 = conn2.createStatement();
                        ResultSet rs2 = stmt2.executeQuery("PRAGMA index_info(" + indexName + ")")) {
                    while (rs2.next()) {
                        indexColumns.add(rs2.getString("name"));
                    }
                }
                if (target.equals(indexColumns)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void assertSqlRejected(String sql) {
        assertThatThrownBy(() -> execute(sql))
                .isInstanceOf(SQLException.class)
                .satisfies(t -> assertThat(t.getMessage()).isNotNull());
    }

    private boolean schemaObjectExists(String type, String name) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='" + type + "' AND name='" + name + "'")) {
            return rs.next() && rs.getInt(1) > 0;
        }
    }

    private String schemaObjectSql(String type, String name) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT sql FROM sqlite_master WHERE type='" + type + "' AND name='" + name + "'")) {
            assertThat(rs.next()).isTrue();
            return rs.getString(1);
        }
    }

    private List<String> schemaObjectNames(String type) throws Exception {
        List<String> names = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery(
                        "SELECT name FROM sqlite_master WHERE type='" + type + "' ORDER BY name")) {
            while (rs.next()) {
                names.add(rs.getString(1));
            }
        }
        return names;
    }

    private List<String> triggerNames() throws Exception {
        return schemaObjectNames("trigger");
    }

    private List<String> postSearchTriggerNames() throws Exception {
        List<String> names = new ArrayList<>();
        for (String name : triggerNames()) {
            if (name.startsWith("posts_search_")) {
                names.add(name);
            }
        }
        return names;
    }

    private String integrityCheck() throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("PRAGMA integrity_check")) {
            assertThat(rs.next()).isTrue();
            return rs.getString(1);
        }
    }

    private void assertSearchFtsIntegrity() throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement()) {
            stmt.execute(
                    "INSERT INTO search_posts(search_posts, rank) VALUES('integrity-check', 1)");
        }
    }

    private long searchMatchCount(String phrase) throws Exception {
        try (Connection conn = DriverManager.getConnection(url);
                PreparedStatement stmt = conn.prepareStatement(
                        "SELECT COUNT(*) FROM search_posts WHERE search_posts MATCH ?")) {
            stmt.setString(1, phrase);
            try (ResultSet rs = stmt.executeQuery()) {
                assertThat(rs.next()).isTrue();
                return rs.getLong(1);
            }
        }
    }

    private List<Long> searchRowIds(String phrase) throws Exception {
        List<Long> rowIds = new ArrayList<>();
        try (Connection conn = DriverManager.getConnection(url);
                PreparedStatement stmt = conn.prepareStatement(
                        "SELECT rowid FROM search_posts WHERE search_posts MATCH ? ORDER BY rowid")) {
            stmt.setString(1, phrase);
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    rowIds.add(rs.getLong(1));
                }
            }
        }
        return rowIds;
    }

    private void assertV8SearchSchema() throws Exception {
        assertThat(schemaObjectExists("table", "search_posts")).isTrue();
        String ddl = schemaObjectSql("table", "search_posts");
        assertThat(ddl.toUpperCase()).contains("USING FTS5");
        assertThat(ddl).contains("content='posts'");
        assertThat(ddl).contains("content_rowid='id'");
        assertThat(ddl).contains("unicode61 remove_diacritics 2");
        assertThat(postSearchTriggerNames())
                .containsExactlyInAnyOrder("posts_search_ai", "posts_search_ad", "posts_search_au");
        assertThat(schemaObjectSql("trigger", "posts_search_ai")).contains("AFTER INSERT ON posts");
        assertThat(schemaObjectSql("trigger", "posts_search_au"))
                .contains("AFTER UPDATE OF content ON posts");
        assertThat(schemaObjectSql("trigger", "posts_search_ad")).contains("AFTER DELETE ON posts");
        assertThat(indexExists("idx_posts_timeline")).isTrue();
        assertThat(hasIndex("posts", "created_at", "id")).isTrue();
        assertThat(integrityCheck()).isEqualTo("ok");
        assertSearchFtsIntegrity();
    }

    private void assertV9PostImagesSchema() throws Exception {
        assertThat(tableExists("post_images")).isTrue();
        assertThat(columnIsNullable("post_images", "post_id")).isFalse();
        assertThat(columnIsNullable("post_images", "storage_key")).isFalse();
        assertThat(columnIsNullable("post_images", "content_type")).isFalse();
        assertThat(columnIsNullable("post_images", "byte_size")).isFalse();
        assertThat(columnIsNullable("post_images", "width")).isFalse();
        assertThat(columnIsNullable("post_images", "height")).isFalse();
        assertThat(columnIsNullable("post_images", "sha256")).isFalse();
        assertThat(columnIsNullable("post_images", "created_at")).isFalse();
        assertThat(primaryKeyOrder("post_images", "id")).isEqualTo(1);
        assertThat(primaryKeyOrder("post_images", "post_id")).isZero();
        assertThat(primaryKeyOrder("post_images", "storage_key")).isZero();
        assertThat(hasUniqueIndex("post_images", "post_id")).isTrue();
        assertThat(hasUniqueIndex("post_images", "storage_key")).isTrue();
        assertThat(fkExists("post_images", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void emptyDatabaseBootstrapsV1ThroughV10() throws Exception {
        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(0)).containsExactly("1", "SQL", "V1__create_legacy_posts.sql", "1");
        assertThat(history.get(1)).containsExactly("2", "SQL", "V2__add_cursor_timeline_indexes.sql", "1");
        assertThat(history.get(2)).containsExactly("3", "SQL", "V3__add_post_replies.sql", "1");
        assertThat(history.get(3))
                .containsExactly("4", "SQL", "V4__add_accounts_and_ownership.sql", "1");
        assertThat(history.get(4))
                .containsExactly("5", "SQL", "V5__add_post_likes.sql", "1");
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertV8SearchSchema();
        assertV9PostImagesSchema();
        assertV10ModerationSchema();

        assertThat(tableExists("posts")).isTrue();
        assertThat(tableExists("replies")).isTrue();
        assertThat(tableExists("accounts")).isTrue();
        assertThat(tableExists("post_likes")).isTrue();
        assertThat(tableExists("post_reposts")).isTrue();
        assertThat(tableExists("notifications")).isTrue();
        assertThat(tableExists("notification_read_state")).isTrue();
        assertThat(tableExists("post_images")).isTrue();
        assertThat(tableExists("flyway_schema_history")).isTrue();
        assertThat(tableExists("abuse_rate_limit_buckets")).isTrue();
        assertThat(tableExists("content_reports")).isTrue();
        assertThat(tableExists("abuse_signals")).isTrue();

        assertThat(columnExists("accounts", "id")).isTrue();
        assertThat(columnExists("accounts", "handle")).isTrue();
        assertThat(columnExists("accounts", "display_name")).isTrue();
        assertThat(columnExists("accounts", "bio")).isTrue();
        assertThat(columnExists("accounts", "password_hash")).isTrue();
        assertThat(columnExists("accounts", "created_at")).isTrue();
        assertThat(columnExists("accounts", "updated_at")).isTrue();
        assertThat(columnExists("posts", "author_account_id")).isTrue();
        assertThat(columnExists("replies", "author_account_id")).isTrue();
        assertThat(columnIsNullable("posts", "author_account_id")).isTrue();
        assertThat(columnIsNullable("replies", "author_account_id")).isTrue();
        assertThat(columnIsNullable("post_likes", "post_id")).isFalse();
        assertThat(columnIsNullable("post_likes", "account_id")).isFalse();
        assertThat(columnExists("post_likes", "created_at")).isTrue();
        assertThat(primaryKeyOrder("post_likes", "post_id")).isEqualTo(1);
        assertThat(primaryKeyOrder("post_likes", "account_id")).isEqualTo(2);
        assertThat(primaryKeyOrder("post_likes", "created_at")).isZero();
        assertThat(columnExists("post_reposts", "id")).isTrue();
        assertThat(columnIsNullable("post_reposts", "post_id")).isFalse();
        assertThat(columnIsNullable("post_reposts", "account_id")).isFalse();
        assertThat(columnIsNullable("post_reposts", "created_at")).isFalse();
        assertThat(primaryKeyOrder("post_reposts", "id")).isEqualTo(1);
        assertThat(primaryKeyOrder("post_reposts", "post_id")).isZero();
        assertThat(primaryKeyOrder("post_reposts", "account_id")).isZero();
        assertThat(hasUniqueIndex("post_reposts", "post_id", "account_id")).isTrue();
        assertThat(columnExists("notifications", "id")).isTrue();
        assertThat(columnIsNullable("notifications", "recipient_account_id")).isFalse();
        assertThat(columnIsNullable("notifications", "actor_account_id")).isFalse();
        assertThat(columnIsNullable("notifications", "post_id")).isFalse();
        assertThat(columnIsNullable("notifications", "reply_id")).isTrue();
        assertThat(columnIsNullable("notifications", "type")).isFalse();
        assertThat(columnIsNullable("notifications", "created_at")).isFalse();
        assertThat(primaryKeyOrder("notifications", "id")).isEqualTo(1);
        assertThat(columnExists("notification_read_state", "account_id")).isTrue();
        assertThat(columnIsNullable("notification_read_state", "read_through_id")).isFalse();
        assertThat(columnIsNullable("notification_read_state", "updated_at")).isFalse();
        assertThat(primaryKeyOrder("notification_read_state", "account_id")).isEqualTo(1);

        assertThat(indexExists("idx_posts_timeline")).isTrue();
        assertThat(indexExists("idx_posts_channel_timeline")).isTrue();
        assertThat(indexExists("idx_posts_channel")).isFalse();
        assertThat(indexExists("idx_posts_created_at")).isFalse();
        assertThat(indexExists("idx_replies_post_timeline")).isTrue();
        assertThat(indexExists("idx_post_reposts_timeline")).isTrue();
        assertThat(indexExists("idx_post_reposts_account_timeline")).isTrue();
        assertThat(indexExists("idx_notifications_recipient_page")).isTrue();
        assertThat(hasIndex("notifications", "recipient_account_id", "id")).isTrue();
        assertThat(hasUniqueIndex("notifications", "reply_id")).isTrue();

        assertThat(fkExists("posts", "author_account_id", "accounts", "SET NULL")).isTrue();
        assertThat(fkExists("replies", "author_account_id", "accounts", "SET NULL")).isTrue();
        assertThat(fkExists("post_likes", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(fkExists("post_likes", "account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("post_reposts", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(fkExists("post_reposts", "account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("notifications", "recipient_account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("notifications", "actor_account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("notifications", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(fkExists("notifications", "reply_id", "replies", "CASCADE")).isTrue();
        assertThat(fkExists("notification_read_state", "account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("post_images", "post_id", "posts", "CASCADE")).isTrue();

        assertThat(indexExists("idx_posts_author_timeline")).isTrue();
        assertThat(indexExists("idx_replies_author")).isTrue();

        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM posts")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt(1)).isZero();
        }
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM replies")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt(1)).isZero();
        }
        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("SELECT COUNT(*) FROM accounts")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getInt(1)).isZero();
        }
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_rate_limit_buckets")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_signals")).isZero();

        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (1, 'bob', 'Bob', 'hash')",
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (2, 'alice', 'Alice', 'hash')",
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (10, 'Bob', 'post', 'home', 1)",
                "INSERT INTO replies (id, post_id, author, content, author_account_id) VALUES (20, 10, 'Alice', 'reply', 2)",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, reply_id, type) VALUES (1, 2, 10, 20, 'REPLY')",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (1, 2, 10, 'LIKE')",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (1, 2, 10, 'REPOST')");
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isEqualTo(3);
        assertSqlRejected(
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (1, 2, 10, 'REPLY')");
        assertSqlRejected(
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, reply_id, type) VALUES (1, 2, 10, 20, 'LIKE')");
        assertSqlRejected(
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (1, 2, 10, 'UNKNOWN')");
        assertSqlRejected(
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, reply_id, type) VALUES (1, 2, 10, 20, 'REPLY')");
        execute(
                "INSERT INTO notification_read_state (account_id, read_through_id) VALUES (1, 0)",
                "INSERT INTO notification_read_state (account_id, read_through_id) VALUES (2, 5)");
        assertSqlRejected(
                "INSERT INTO notification_read_state (account_id, read_through_id) VALUES (2, -1)");

        execute("PRAGMA foreign_keys = ON", "DELETE FROM accounts WHERE id = 1");
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state WHERE account_id = 1"))
                .isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state WHERE account_id = 2"))
                .isEqualTo(1);
    }

    @Test
    void legacyPostsSchemaBaselinesAndPreservesData() throws Exception {
        execute(
                "CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, content TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('home', 'tech', 'ops')), created_at TEXT NOT NULL DEFAULT (datetime('now')))",
                "CREATE INDEX idx_posts_channel ON posts(channel)",
                "CREATE INDEX idx_posts_created_at ON posts(created_at DESC)",
                "INSERT INTO posts (id, author, content, channel, created_at) VALUES (41, 'alice', 'legacy post', 'home', '2024-01-02 03:04:05')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(0)).containsExactly("1", "BASELINE", "<< Flyway Baseline >>", "1");
        assertThat(history.get(1)).containsExactly("2", "SQL", "V2__add_cursor_timeline_indexes.sql", "1");
        assertThat(history.get(2)).containsExactly("3", "SQL", "V3__add_post_replies.sql", "1");
        assertThat(history.get(3))
                .containsExactly("4", "SQL", "V4__add_accounts_and_ownership.sql", "1");
        assertThat(history.get(4))
                .containsExactly("5", "SQL", "V5__add_post_likes.sql", "1");
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertV8SearchSchema();

        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("""
                        SELECT id, author, content, channel, created_at, author_account_id
                        FROM posts""")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("id")).isEqualTo(41);
            assertThat(rs.getString("author")).isEqualTo("alice");
            assertThat(rs.getString("content")).isEqualTo("legacy post");
            assertThat(rs.getString("channel")).isEqualTo("home");
            assertThat(rs.getString("created_at")).isEqualTo("2024-01-02 03:04:05");
            assertThat(rs.getString("author_account_id")).isNull();
            assertThat(rs.next()).isFalse();
        }

        assertThat(indexExists("idx_posts_timeline")).isTrue();
        assertThat(indexExists("idx_posts_channel_timeline")).isTrue();
        assertThat(indexExists("idx_posts_channel")).isFalse();
        assertThat(indexExists("idx_posts_created_at")).isFalse();
        assertThat(indexExists("idx_replies_post_timeline")).isTrue();
        assertThat(tableExists("replies")).isTrue();
        assertThat(tableExists("accounts")).isTrue();
        assertThat(tableExists("post_likes")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isZero();
        assertThat(tableExists("post_reposts")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(tableExists("notifications")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(tableExists("notification_read_state")).isTrue();

        execute("INSERT INTO posts (author, content, channel) VALUES ('next', 'after migration', 'home')");
        assertThat(queryLong("SELECT MAX(id) FROM posts")).isEqualTo(42);
    }

    @Test
    void currentPreFlywaySchemaPreservesBothTables() throws Exception {
        execute(
                "CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author TEXT NOT NULL, content TEXT NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('home', 'tech', 'ops')), created_at TEXT NOT NULL DEFAULT (datetime('now')))",
                "CREATE INDEX idx_posts_timeline ON posts(created_at DESC, id DESC)",
                "CREATE INDEX idx_posts_channel_timeline ON posts(channel, created_at DESC, id DESC)",
                "INSERT INTO posts (id, author, content, channel, created_at) VALUES (41, 'bob', 'current post', 'tech', '2024-02-03 04:05:06')",
                "CREATE TABLE replies (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE, author TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
                "CREATE INDEX idx_replies_post_timeline ON replies(post_id, created_at ASC, id ASC)",
                "INSERT INTO replies (id, post_id, author, content, created_at) VALUES (17, 41, 'bob', 'a reply', '2024-02-03 04:06:07')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(0)).containsExactly("1", "BASELINE", "<< Flyway Baseline >>", "1");
        assertThat(history.get(1)).containsExactly("2", "SQL", "V2__add_cursor_timeline_indexes.sql", "1");
        assertThat(history.get(2)).containsExactly("3", "SQL", "V3__add_post_replies.sql", "1");
        assertThat(history.get(3))
                .containsExactly("4", "SQL", "V4__add_accounts_and_ownership.sql", "1");
        assertThat(history.get(4))
                .containsExactly("5", "SQL", "V5__add_post_likes.sql", "1");
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertV8SearchSchema();
        assertThat(searchMatchCount("\"current\"")).isEqualTo(1);

        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("""
                        SELECT id, author, content, channel, created_at, author_account_id
                        FROM posts""")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("id")).isEqualTo(41);
            assertThat(rs.getString("author")).isEqualTo("bob");
            assertThat(rs.getString("content")).isEqualTo("current post");
            assertThat(rs.getString("channel")).isEqualTo("tech");
            assertThat(rs.getString("created_at")).isEqualTo("2024-02-03 04:05:06");
            assertThat(rs.getString("author_account_id")).isNull();
            assertThat(rs.next()).isFalse();
        }

        try (Connection conn = DriverManager.getConnection(url);
                Statement stmt = conn.createStatement();
                ResultSet rs = stmt.executeQuery("""
                        SELECT id, post_id, author, content, created_at, author_account_id
                        FROM replies""")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getLong("id")).isEqualTo(17);
            assertThat(rs.getLong("post_id")).isEqualTo(41);
            assertThat(rs.getString("author")).isEqualTo("bob");
            assertThat(rs.getString("content")).isEqualTo("a reply");
            assertThat(rs.getString("created_at")).isEqualTo("2024-02-03 04:06:07");
            assertThat(rs.getString("author_account_id")).isNull();
            assertThat(rs.next()).isFalse();
        }

        assertThat(indexExists("idx_posts_timeline")).isTrue();
        assertThat(indexExists("idx_posts_channel_timeline")).isTrue();
        assertThat(indexExists("idx_replies_post_timeline")).isTrue();
        assertThat(tableExists("accounts")).isTrue();
        assertThat(tableExists("post_likes")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isZero();
        assertThat(tableExists("post_reposts")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(tableExists("notifications")).isTrue();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(tableExists("notification_read_state")).isTrue();

        execute(
                "INSERT INTO posts (author, content, channel) VALUES ('next', 'after migration', 'tech')",
                "INSERT INTO replies (post_id, author, content) VALUES (41, 'next', 'after migration')");
        assertThat(queryLong("SELECT MAX(id) FROM posts")).isEqualTo(42);
        assertThat(queryLong("SELECT MAX(id) FROM replies")).isEqualTo(18);
    }

    @Test
    void v3DatabaseUpgradesToV10PreservingUnownedContentAndIds() throws Exception {
        runMigration("3");
        execute(
                "INSERT INTO posts (id, author, content, channel, created_at) VALUES (41, 'Alice', 'v3 post', 'ops', '2024-03-01 05:07:08')",
                "INSERT INTO replies (id, post_id, author, content, created_at) VALUES (17, 41, 'Bob', 'v3 reply', '2024-03-01 05:08:09')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(2))
                .containsExactly("3", "SQL", "V3__add_post_replies.sql", "1");
        assertThat(history.get(3))
                .containsExactly("4", "SQL", "V4__add_accounts_and_ownership.sql", "1");
        assertThat(history.get(4))
                .containsExactly("5", "SQL", "V5__add_post_likes.sql", "1");
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertV8SearchSchema();
        assertThat(searchMatchCount("\"v3\"")).isEqualTo(1);
        assertThat(searchMatchCount("\"reply\"")).isZero();

        assertThat(queryLong(
                        "SELECT COUNT(*) FROM posts WHERE id = 41 AND author_account_id IS NULL"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM replies WHERE id = 17 AND author_account_id IS NULL"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state")).isZero();

        execute(
                "INSERT INTO posts (author, content, channel) VALUES ('next', 'after migration', 'ops')",
                "INSERT INTO replies (post_id, author, content) VALUES (41, 'next', 'after migration')");
        assertThat(queryLong("SELECT MAX(id) FROM posts")).isEqualTo(42);
        assertThat(queryLong("SELECT MAX(id) FROM replies")).isEqualTo(18);
    }

    @Test
    void v4DatabaseUpgradesToV10PreservingAccountsAndOwnedContent() throws Exception {
        runMigration("4");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-03-04 05:06:07', '2024-03-04 05:06:07')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'owned post', 'ops', '2024-03-04 05:07:08', 7)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Alice', 'owned reply', '2024-03-04 05:08:09', 7)");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(4))
                .containsExactly("5", "SQL", "V5__add_post_likes.sql", "1");
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");
        assertThat(queryLong("SELECT COUNT(*) FROM accounts WHERE id = 7 AND handle = 'alice'")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 41 AND author_account_id = 7")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM replies WHERE id = 17 AND author_account_id = 7")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state")).isZero();

        assertV8SearchSchema();
        assertThat(searchMatchCount("\"owned\"")).isEqualTo(1);
    }

    @Test
    void unknownNonEmptySchemaFailsClosed() throws Exception {
        execute("CREATE TABLE foo (id INTEGER PRIMARY KEY)");

        assertThatThrownBy(this::runMigration).isInstanceOf(FlywayException.class);

        assertThat(tableExists("flyway_schema_history")).isFalse();
        assertThat(tableExists("foo")).isTrue();
    }

    @Test
    void v5DatabaseUpgradesToV10PreservingAccountsPostsRepliesLikesAndIds() throws Exception {
        runMigration("5");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-04-05 06:07:08', '2024-04-05 06:07:08')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'owned post', 'tech', '2024-04-05 06:08:09', 7)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Bob', 'a reply', '2024-04-05 06:09:10', null)",
                "INSERT INTO post_likes (post_id, account_id, created_at) VALUES (41, 7, '2024-04-05 06:10:11')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(5))
                .containsExactly("6", "SQL", "V6__add_post_reposts.sql", "1");
        assertThat(history.get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertThat(queryLong("SELECT COUNT(*) FROM accounts WHERE id = 7 AND handle = 'alice'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM posts WHERE id = 41 AND author_account_id = 7 AND author = 'Alice'"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM replies WHERE id = 17 AND post_id = 41"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes WHERE post_id = 41 AND account_id = 7"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state")).isZero();

        assertV8SearchSchema();
        assertThat(searchMatchCount("\"owned\"")).isEqualTo(1);

        execute(
                "INSERT INTO posts (author, content, channel) VALUES ('next', 'after migration', 'tech')",
                "INSERT INTO replies (post_id, author, content) VALUES (41, 'next', 'after migration')",
                "INSERT INTO post_reposts (post_id, account_id) VALUES (41, 7)");
        assertThat(queryLong("SELECT MAX(id) FROM posts")).isEqualTo(42);
        assertThat(queryLong("SELECT MAX(id) FROM replies")).isEqualTo(18);
        assertThat(queryLong("SELECT MAX(id) FROM post_reposts")).isEqualTo(1);
    }

    @Test
    void v6DatabaseUpgradesToV10PreservingAccountsPostsRepliesLikesRepostsAndBackfill()
            throws Exception {
        runMigration("6");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-05-06 07:08:09', '2024-05-06 07:08:09')",
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (8, 'bob', 'Bob', 'hash', 'bio', '2024-05-06 07:08:09', '2024-05-06 07:08:09')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'owned post', 'tech', '2024-05-06 07:09:10', 7)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Bob', 'a reply', '2024-05-06 07:10:11', 8)",
                "INSERT INTO post_likes (post_id, account_id, created_at) VALUES (41, 8, '2024-05-06 07:11:12')",
                "INSERT INTO post_reposts (post_id, account_id, created_at) VALUES (41, 8, '2024-05-06 07:12:13')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(6)).containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertV8SearchSchema();

        assertThat(queryLong("SELECT COUNT(*) FROM accounts WHERE id IN (7, 8)")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 41 AND author_account_id = 7"))
                .isEqualTo(1);
        assertThat(
                queryLong("SELECT COUNT(*) FROM replies WHERE id = 17 AND post_id = 41 AND author_account_id = 8"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes WHERE post_id = 41 AND account_id = 8"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts WHERE post_id = 41 AND account_id = 8"))
                .isEqualTo(1);

        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM notification_read_state")).isZero();
    }

    @Test
    void searchTriggersSynchronizePostsContentExactTermsAndLifecycle() throws Exception {
        runMigration();
        assertV8SearchSchema();

        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (1, 'alice', 'Alice', 'hash')",
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (10, 'Alice', 'alpha bolt', 'home', 1)");
        assertThat(searchMatchCount("\"alpha\"")).isEqualTo(1);
        assertThat(searchMatchCount("\"bolt\"")).isEqualTo(1);
        assertThat(searchRowIds("\"alpha\"")).containsExactly(10L);

        execute(
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (11, 'Bob', 'wallet', 'tech', null)");
        assertThat(searchMatchCount("\"wallet\"")).isEqualTo(1);
        assertThat(searchMatchCount("\"wal\"")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM search_posts")).isEqualTo(2);

        execute("UPDATE posts SET content = 'alpha volt' WHERE id = 10");
        assertThat(searchMatchCount("\"bolt\"")).isZero();
        assertThat(searchMatchCount("\"volt\"")).isEqualTo(1);
        assertThat(searchRowIds("\"volt\"")).containsExactly(10L);
        assertThat(searchMatchCount("\"alpha\"")).isEqualTo(1);

        execute("DELETE FROM posts WHERE id = 11");
        assertThat(searchMatchCount("\"wallet\"")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM posts")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM search_posts")).isEqualTo(1);
        assertThat(integrityCheck()).isEqualTo("ok");
        assertSearchFtsIntegrity();
    }

    @Test
    void populatedV7UpgradePreservesDataAndBackfillsEveryExistingPost() throws Exception {
        runMigration("7");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-07-08 09:10:11', '2024-07-08 09:10:11')",
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (8, 'bob', 'Bob', 'hash', 'bio', '2024-07-08 09:10:11', '2024-07-08 09:10:11')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'alpha bolt', 'tech', '2024-07-08 09:11:12', 7)",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (42, 'Bob', 'yellow volt', 'home', '2024-07-08 09:12:13', 8)",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (43, 'Alice', 'red wallet', 'ops', '2024-07-08 09:13:14', 7)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Bob', 'a reply slice', '2024-07-08 09:14:15', 8)",
                "INSERT INTO post_likes (post_id, account_id, created_at) VALUES (41, 8, '2024-07-08 09:15:16')",
                "INSERT INTO post_reposts (post_id, account_id, created_at) VALUES (41, 8, '2024-07-08 09:16:17')",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (7, 8, 41, 'LIKE')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertThat(queryLong("SELECT COUNT(*) FROM accounts WHERE id IN (7, 8)")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id IN (41, 42, 43)")).isEqualTo(3);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM posts WHERE id = 41 AND author_account_id = 7 AND content = 'alpha bolt'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM replies WHERE id = 17 AND post_id = 41 AND content = 'a reply slice'"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes WHERE post_id = 41 AND account_id = 8"))
                .isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts WHERE post_id = 41 AND account_id = 8"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM notifications WHERE recipient_account_id = 7 AND post_id = 41 AND type = 'LIKE'"))
                .isEqualTo(1);

        assertV8SearchSchema();
        assertThat(searchRowIds("\"bolt\"")).containsExactly(41L);
        assertThat(searchRowIds("\"volt\"")).containsExactly(42L);
        assertThat(searchRowIds("\"wallet\"")).containsExactly(43L);
        assertThat(searchMatchCount("\"yellow\"")).isEqualTo(1);
        assertThat(searchMatchCount("\"reply\"")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM search_posts")).isEqualTo(3);
        assertThat(integrityCheck()).isEqualTo("ok");
        assertSearchFtsIntegrity();
    }

    @Test
    void failedV8MigrationDoesNotLeavePartialSearchSchemaOrHistory() throws Exception {
        runMigration("7");
        execute("""
                CREATE TRIGGER posts_search_ai AFTER INSERT ON posts BEGIN
                    SELECT 1;
                END""");

        assertThatThrownBy(this::runMigration).isInstanceOf(FlywayException.class);

        assertThat(schemaObjectExists("table", "search_posts")).isFalse();
        assertThat(postSearchTriggerNames()).containsExactly("posts_search_ai");
        assertThat(queryHistory()).hasSize(7);
        assertThat(queryHistory().get(6))
                .containsExactly("7", "SQL", "V7__add_notifications.sql", "1");
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void searchTriggerFailureRollsBackPostWriteAtomically() throws Exception {
        runMigration();
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (1, 'alice', 'Alice', 'hash')",
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (10, 'Alice', 'alpha bolt', 'home', 1)");
        assertThat(searchMatchCount("\"bolt\"")).isEqualTo(1);

        execute("DROP TABLE search_posts");
        assertThat(schemaObjectExists("table", "search_posts")).isFalse();
        assertThat(postSearchTriggerNames())
                .containsExactlyInAnyOrder("posts_search_ai", "posts_search_ad", "posts_search_au");

        try (Connection conn = DriverManager.getConnection(url)) {
            conn.setAutoCommit(false);
            try (Statement stmt = conn.createStatement()) {
                stmt.execute(
                        "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (2, 'bob', 'Bob', 'hash')");
                assertThatThrownBy(() -> stmt.execute(
                                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (11, 'Bob', 'new post', 'home', 2)"))
                        .isInstanceOf(SQLException.class)
                        .satisfies(t -> assertThat(t.getMessage()).isNotNull());
            } finally {
                try {
                    conn.rollback();
                } catch (SQLException ignored) {
                    // The failing trigger may already have aborted the transaction.
                }
            }
        }

        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM posts")).isEqualTo(1);
        assertThat(queryLong("SELECT MAX(id) FROM posts")).isEqualTo(10);
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 11")).isZero();
    }

    @Test
    void emptyV8DatabaseUpgradesToV10WithEmptyPostImages() throws Exception {
        runMigration("8");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");
        assertV8SearchSchema();
        assertV9PostImagesSchema();
        assertV10ModerationSchema();
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isZero();
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void populatedV8DatabaseUpgradesToV10PreservingCountsIdsAndTimestamps() throws Exception {
        runMigration("8");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-08-09 10:11:12', '2024-08-09 10:11:12')",
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (8, 'bob', 'Bob', 'hash', 'bio', '2024-08-09 10:11:12', '2024-08-09 10:11:12')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'alpha bolt', 'tech', '2024-08-09 10:12:13', 7)",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (42, 'Bob', 'yellow volt', 'home', '2024-08-09 10:13:14', 8)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Bob', 'a reply', '2024-08-09 10:14:15', 8)",
                "INSERT INTO post_likes (post_id, account_id, created_at) VALUES (41, 8, '2024-08-09 10:15:16')",
                "INSERT INTO post_reposts (post_id, account_id, created_at) VALUES (41, 8, '2024-08-09 10:16:17')",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (7, 8, 41, 'LIKE')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(7)).containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(history.get(8)).containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM posts")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM replies")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isZero();

        assertThat(queryLong(
                        "SELECT COUNT(*) FROM accounts WHERE id = 7 AND created_at = '2024-08-09 10:11:12' AND updated_at = '2024-08-09 10:11:12'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM posts WHERE id = 41 AND content = 'alpha bolt' AND created_at = '2024-08-09 10:12:13' AND author_account_id = 7"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM replies WHERE id = 17 AND content = 'a reply' AND created_at = '2024-08-09 10:14:15'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM post_likes WHERE post_id = 41 AND account_id = 8 AND created_at = '2024-08-09 10:15:16'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM post_reposts WHERE post_id = 41 AND account_id = 8 AND created_at = '2024-08-09 10:16:17'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM notifications WHERE recipient_account_id = 7 AND actor_account_id = 8 AND post_id = 41 AND type = 'LIKE'"))
                .isEqualTo(1);

        assertV8SearchSchema();
        assertThat(searchRowIds("\"bolt\"")).containsExactly(41L);
        assertThat(queryLong("SELECT COUNT(*) FROM search_posts")).isEqualTo(2);
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void postImagesConstraintsEnforceOneToOneUniqueKeyStrictChecksAndCascade()
            throws Exception {
        runMigration();
        execute(
                "INSERT INTO posts (id, author, content, channel) VALUES (10, 'Alice', 'post', 'home')",
                "INSERT INTO posts (id, author, content, channel) VALUES (11, 'Bob', 'post', 'tech')");

        execute("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-a', 'image/jpeg', 100, 400, 300, '%s')"""
                .formatted(SHA256));

        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/gif', 100, 400, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 5242881, 400, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 0, 400, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 0, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 4097, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 400, 4097, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 4000, 3001, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 400, 300, '%s')"""
                .formatted("ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 400, 300, 'abc')""");
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 400, 300,
                        'gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg')""");

        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (10, 'key-b', 'image/jpeg', 100, 400, 300, '%s')"""
                .formatted(SHA256));
        assertSqlRejected("""
                INSERT INTO post_images
                    (post_id, storage_key, content_type, byte_size, width, height, sha256)
                VALUES (11, 'key-a', 'image/jpeg', 100, 400, 300, '%s')"""
                .formatted(SHA256));
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isEqualTo(1);

        assertThatThrownBy(() -> execute(
                        "PRAGMA foreign_keys = ON",
                        "INSERT INTO post_images (post_id, storage_key, content_type, byte_size, width, height, sha256) VALUES (999, 'key-c', 'image/jpeg', 100, 400, 300, '"
                                + SHA256 + "')"))
                .isInstanceOf(SQLException.class);

        execute("PRAGMA foreign_keys = ON", "DELETE FROM posts WHERE id = 10");
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM posts")).isEqualTo(1);
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void failedV9MigrationDoesNotLeavePartialPostImagesSchemaOrHistory() throws Exception {
        runMigration("8");
        execute("CREATE TABLE post_images (id INTEGER PRIMARY KEY)");

        assertThatThrownBy(this::runMigration).isInstanceOf(FlywayException.class);

        assertThat(queryHistory()).hasSize(8);
        assertThat(queryHistory().get(7))
                .containsExactly("8", "SQL", "V8__add_post_search.sql", "1");
        assertThat(schemaObjectSql("table", "post_images"))
                .isEqualTo("CREATE TABLE post_images (id INTEGER PRIMARY KEY)");
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    private void assertV10ModerationSchema() throws Exception {
        assertThat(tableExists("abuse_rate_limit_buckets")).isTrue();
        assertThat(tableExists("content_reports")).isTrue();
        assertThat(tableExists("abuse_signals")).isTrue();

        assertThat(columnIsNullable("abuse_rate_limit_buckets", "scope")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "subject_kind")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "subject_hmac")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "window_start_epoch")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "window_end_epoch")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "expires_at_epoch")).isFalse();
        assertThat(columnIsNullable("abuse_rate_limit_buckets", "request_count")).isFalse();
        assertThat(primaryKeyOrder("abuse_rate_limit_buckets", "scope")).isEqualTo(1);
        assertThat(primaryKeyOrder("abuse_rate_limit_buckets", "subject_kind")).isEqualTo(2);
        assertThat(primaryKeyOrder("abuse_rate_limit_buckets", "subject_hmac")).isEqualTo(3);
        assertThat(primaryKeyOrder("abuse_rate_limit_buckets", "window_start_epoch")).isEqualTo(4);
        assertThat(indexExists("idx_abuse_rate_limit_buckets_expiry")).isTrue();

        assertThat(columnIsNullable("content_reports", "reporter_account_id")).isFalse();
        assertThat(columnIsNullable("content_reports", "target_type")).isFalse();
        assertThat(columnIsNullable("content_reports", "post_id")).isTrue();
        assertThat(columnIsNullable("content_reports", "reply_id")).isTrue();
        assertThat(columnIsNullable("content_reports", "reason")).isFalse();
        assertThat(columnIsNullable("content_reports", "status")).isFalse();
        assertThat(columnIsNullable("content_reports", "created_at")).isFalse();
        assertThat(columnIsNullable("content_reports", "expires_at_epoch")).isFalse();
        assertThat(primaryKeyOrder("content_reports", "id")).isEqualTo(1);
        assertThat(indexExists("uq_content_reports_reporter_post")).isTrue();
        assertThat(schemaObjectSql("index", "uq_content_reports_reporter_post"))
                .contains("reporter_account_id")
                .contains("post_id")
                .contains("WHERE post_id IS NOT NULL");
        assertThat(indexExists("uq_content_reports_reporter_reply")).isTrue();
        assertThat(schemaObjectSql("index", "uq_content_reports_reporter_reply"))
                .contains("reporter_account_id")
                .contains("reply_id")
                .contains("WHERE reply_id IS NOT NULL");
        assertThat(indexExists("idx_content_reports_expiry")).isTrue();
        assertThat(fkExists("content_reports", "reporter_account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("content_reports", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(fkExists("content_reports", "reply_id", "replies", "CASCADE")).isTrue();

        assertThat(columnIsNullable("abuse_signals", "action_kind")).isFalse();
        assertThat(columnIsNullable("abuse_signals", "actor_account_id")).isFalse();
        assertThat(columnIsNullable("abuse_signals", "post_id")).isTrue();
        assertThat(columnIsNullable("abuse_signals", "reply_id")).isTrue();
        assertThat(columnIsNullable("abuse_signals", "report_id")).isTrue();
        assertThat(columnIsNullable("abuse_signals", "ip_hmac")).isFalse();
        assertThat(columnIsNullable("abuse_signals", "created_at")).isFalse();
        assertThat(columnIsNullable("abuse_signals", "expires_at_epoch")).isFalse();
        assertThat(primaryKeyOrder("abuse_signals", "id")).isEqualTo(1);
        assertThat(indexExists("uq_abuse_signals_post")).isTrue();
        assertThat(schemaObjectSql("index", "uq_abuse_signals_post"))
                .contains("post_id")
                .contains("WHERE post_id IS NOT NULL");
        assertThat(indexExists("uq_abuse_signals_reply")).isTrue();
        assertThat(schemaObjectSql("index", "uq_abuse_signals_reply"))
                .contains("reply_id")
                .contains("WHERE reply_id IS NOT NULL");
        assertThat(indexExists("uq_abuse_signals_report")).isTrue();
        assertThat(schemaObjectSql("index", "uq_abuse_signals_report"))
                .contains("report_id")
                .contains("WHERE report_id IS NOT NULL");
        assertThat(indexExists("idx_abuse_signals_ip_time")).isTrue();
        assertThat(indexExists("idx_abuse_signals_actor_time")).isTrue();
        assertThat(indexExists("idx_abuse_signals_expiry")).isTrue();
        assertThat(fkExists("abuse_signals", "actor_account_id", "accounts", "CASCADE")).isTrue();
        assertThat(fkExists("abuse_signals", "post_id", "posts", "CASCADE")).isTrue();
        assertThat(fkExists("abuse_signals", "reply_id", "replies", "CASCADE")).isTrue();
        assertThat(fkExists("abuse_signals", "report_id", "content_reports", "CASCADE")).isTrue();

        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void v10ModerationConstraintsRejectInvalidRowsWithoutDeletingParentContent() throws Exception {
        runMigration();
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (1, 'alice', 'Alice', 'hash')",
                "INSERT INTO accounts (id, handle, display_name, password_hash) VALUES (2, 'bob', 'Bob', 'hash')",
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (10, 'Alice', 'post', 'home', 1)",
                "INSERT INTO posts (id, author, content, channel, author_account_id) VALUES (11, 'Bob', 'post', 'tech', 2)",
                "INSERT INTO replies (id, post_id, author, content, author_account_id) VALUES (20, 10, 'Bob', 'reply', 2)");

        String hmac = SHA256;
        String bucket =
                "INSERT INTO abuse_rate_limit_buckets (scope, subject_kind, subject_hmac, window_start_epoch, window_end_epoch, expires_at_epoch, request_count) VALUES ('%s', '%s', '%s', %d, %d, %d, %d)";
        execute(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 1000, 1060, 87460, 3));
        assertSqlRejected(bucket.formatted("NOPE", "ACCOUNT", hmac, 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "OTHER", hmac, 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac.toUpperCase(), 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", "z".repeat(64), 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", "abc", 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 2000, 2060, 88460, 0));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 2000, 2060, 88460, -1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 2000, 2000, 88460, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 2000, 2060, 88459, 1));
        assertSqlRejected(bucket.formatted("CONTENT_WRITE", "ACCOUNT", hmac, 1000, 1060, 87460, 1));
        assertSqlRejected(bucket.formatted("REGISTER", "ACCOUNT", hmac, 2000, 2060, 88460, 1));
        assertSqlRejected(bucket.formatted("LOGIN", "ACCOUNT", hmac, 2000, 2060, 88460, 1));

        String report =
                "INSERT INTO content_reports (reporter_account_id, target_type, post_id, reply_id, reason, status, expires_at_epoch) VALUES (%d, '%s', %s, %s, '%s', 'RECEIVED', %d)";
        execute(
                report.formatted(1, "POST", "10", "NULL", "SPAM", 1800000),
                report.formatted(2, "REPLY", "NULL", "20", "HARASSMENT", 1800000));
        assertSqlRejected(report.formatted(1, "POST", "10", "NULL", "SPAM", 1800000));
        assertSqlRejected(report.formatted(2, "REPLY", "NULL", "20", "SPAM", 1800000));
        assertSqlRejected(report.formatted(1, "POST", "NULL", "20", "SPAM", 1800000));
        assertSqlRejected(report.formatted(1, "POST", "NULL", "NULL", "SPAM", 1800000));
        assertSqlRejected(report.formatted(1, "REPLY", "10", "NULL", "SPAM", 1800000));
        assertSqlRejected(report.formatted(1, "POST", "10", "20", "SPAM", 1800000));
        assertSqlRejected(report.formatted(1, "POST", "10", "NULL", "UNKNOWN", 1800000));
        assertSqlRejected(
                "INSERT INTO content_reports (reporter_account_id, target_type, post_id, reason, status, expires_at_epoch) VALUES (2, 'POST', 11, 'SPAM', 'ACTIONED', 1800000)");
        assertThatThrownBy(() -> execute(
                        "PRAGMA foreign_keys = ON",
                        report.formatted(1, "POST", "999", "NULL", "SPAM", 1800000)))
                .isInstanceOf(SQLException.class);
        assertThatThrownBy(() -> execute(
                        "PRAGMA foreign_keys = ON",
                        report.formatted(999, "POST", "10", "NULL", "SPAM", 1800000)))
                .isInstanceOf(SQLException.class);
        execute(
                report.formatted(2, "POST", "10", "NULL", "SPAM", 1800000),
                report.formatted(1, "POST", "11", "NULL", "SPAM", 1800000));
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isEqualTo(4);

        String signal =
                "INSERT INTO abuse_signals (action_kind, actor_account_id, post_id, reply_id, report_id, ip_hmac, expires_at_epoch) VALUES ('%s', %s, %s, %s, %s, '%s', %d)";
        execute(
                signal.formatted("POST_CREATED", "1", "10", "NULL", "NULL", hmac, 1000000),
                signal.formatted("REPLY_CREATED", "2", "NULL", "20", "NULL", hmac, 1000000),
                signal.formatted("REPORT_CREATED", "1", "NULL", "NULL", "1", hmac, 1000000));
        assertSqlRejected(signal.formatted("SIGNUP", "1", "NULL", "NULL", "NULL", hmac, 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "NULL", "11", "NULL", "NULL", hmac, 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "1", "NULL", "20", "NULL", hmac, 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "1", "10", "NULL", "1", hmac, 1000000));
        assertSqlRejected(signal.formatted("REPLY_CREATED", "1", "10", "20", "NULL", hmac, 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "1", "10", "NULL", "NULL", hmac.toUpperCase(), 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "1", "10", "NULL", "NULL", "z".repeat(64), 1000000));
        assertSqlRejected(signal.formatted("POST_CREATED", "1", "10", "NULL", "NULL", "abc", 1000000));
        assertThatThrownBy(() -> execute(
                        "PRAGMA foreign_keys = ON",
                        signal.formatted("POST_CREATED", "999", "11", "NULL", "NULL", hmac, 1000000)))
                .isInstanceOf(SQLException.class);
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_signals")).isEqualTo(3);

        execute("PRAGMA foreign_keys = ON", "DELETE FROM content_reports WHERE id = 1");
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 10")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isEqualTo(3);
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_signals")).isEqualTo(2);

        execute("PRAGMA foreign_keys = ON", "DELETE FROM posts WHERE id = 10");
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 11")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM replies")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_signals")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(2);

        execute("PRAGMA foreign_keys = ON", "DELETE FROM accounts WHERE id = 1");
        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM posts WHERE id = 11")).isEqualTo(1);
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void populatedV9DatabaseUpgradesToV10PreservingCountsIdsAndMetadata() throws Exception {
        runMigration("9");
        execute(
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (7, 'alice', 'Alice', 'hash', 'bio', '2024-08-09 10:11:12', '2024-08-09 10:11:12')",
                "INSERT INTO accounts (id, handle, display_name, password_hash, bio, created_at, updated_at) VALUES (8, 'bob', 'Bob', 'hash', 'bio', '2024-08-09 10:11:12', '2024-08-09 10:11:12')",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (41, 'Alice', 'alpha bolt', 'tech', '2024-08-09 10:12:13', 7)",
                "INSERT INTO posts (id, author, content, channel, created_at, author_account_id) VALUES (42, 'Bob', 'yellow volt', 'home', '2024-08-09 10:13:14', 8)",
                "INSERT INTO replies (id, post_id, author, content, created_at, author_account_id) VALUES (17, 41, 'Bob', 'a reply', '2024-08-09 10:14:15', 8)",
                "INSERT INTO post_likes (post_id, account_id, created_at) VALUES (41, 8, '2024-08-09 10:15:16')",
                "INSERT INTO post_reposts (post_id, account_id, created_at) VALUES (41, 8, '2024-08-09 10:16:17')",
                "INSERT INTO notifications (recipient_account_id, actor_account_id, post_id, type) VALUES (7, 8, 41, 'LIKE')",
                "INSERT INTO post_images (post_id, storage_key, content_type, byte_size, width, height, sha256) VALUES (41, 'abc-123', 'image/jpeg', 2048, 64, 64, '"
                        + SHA256 + "')");

        runMigration();

        List<String[]> history = queryHistory();
        assertThat(history).hasSize(10);
        assertThat(history.get(8)).containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(history.get(9))
                .containsExactly("10", "SQL", "V10__add_moderation_controls.sql", "1");

        assertThat(queryLong("SELECT COUNT(*) FROM accounts")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM posts")).isEqualTo(2);
        assertThat(queryLong("SELECT COUNT(*) FROM replies")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_likes")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_reposts")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM notifications")).isEqualTo(1);
        assertThat(queryLong("SELECT COUNT(*) FROM post_images")).isEqualTo(1);

        assertThat(queryLong(
                        "SELECT COUNT(*) FROM accounts WHERE id = 7 AND created_at = '2024-08-09 10:11:12' AND updated_at = '2024-08-09 10:11:12'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM posts WHERE id = 41 AND content = 'alpha bolt' AND created_at = '2024-08-09 10:12:13' AND author_account_id = 7"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM replies WHERE id = 17 AND content = 'a reply' AND created_at = '2024-08-09 10:14:15' AND author_account_id = 8"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM post_likes WHERE post_id = 41 AND account_id = 8 AND created_at = '2024-08-09 10:15:16'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM post_reposts WHERE post_id = 41 AND account_id = 8 AND created_at = '2024-08-09 10:16:17'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM notifications WHERE recipient_account_id = 7 AND actor_account_id = 8 AND post_id = 41 AND type = 'LIKE'"))
                .isEqualTo(1);
        assertThat(queryLong(
                        "SELECT COUNT(*) FROM post_images WHERE post_id = 41 AND storage_key = 'abc-123' AND content_type = 'image/jpeg' AND byte_size = 2048 AND width = 64 AND height = 64 AND sha256 = '"
                                + SHA256 + "'"))
                .isEqualTo(1);

        assertV8SearchSchema();
        assertV10ModerationSchema();
        assertThat(searchRowIds("\"bolt\"")).containsExactly(41L);
        assertThat(searchRowIds("\"volt\"")).containsExactly(42L);
        assertThat(queryLong("SELECT COUNT(*) FROM search_posts")).isEqualTo(2);

        assertThat(queryLong("SELECT COUNT(*) FROM abuse_rate_limit_buckets")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM content_reports")).isZero();
        assertThat(queryLong("SELECT COUNT(*) FROM abuse_signals")).isZero();
        assertThat(integrityCheck()).isEqualTo("ok");
    }

    @Test
    void failedV10MigrationDoesNotLeavePartialModerationSchemaOrHistory() throws Exception {
        runMigration("9");
        execute("CREATE TABLE abuse_rate_limit_buckets (id INTEGER PRIMARY KEY)");

        assertThatThrownBy(this::runMigration).isInstanceOf(FlywayException.class);

        assertThat(queryHistory()).hasSize(9);
        assertThat(queryHistory().get(8))
                .containsExactly("9", "SQL", "V9__add_post_images.sql", "1");
        assertThat(schemaObjectSql("table", "abuse_rate_limit_buckets"))
                .isEqualTo("CREATE TABLE abuse_rate_limit_buckets (id INTEGER PRIMARY KEY)");
        assertThat(schemaObjectExists("table", "content_reports")).isFalse();
        assertThat(schemaObjectExists("table", "abuse_signals")).isFalse();
        assertThat(integrityCheck()).isEqualTo("ok");
    }

}
