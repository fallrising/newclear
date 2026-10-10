package com.fallrising.cms.contract;

import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import javax.sql.DataSource;

/** One PostgreSQL 16 container for all store contract tests; every call returns a fresh schema. */
final class PostgresFixture {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    private PostgresFixture() {}

    /** An empty schema migrated to the latest version. */
    static DataSource cleanDataSource() {
        DataSource dataSource = emptyDataSource();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        return dataSource;
    }

    /** An empty schema without any migration applied (for migration tests such as EntryIndexBackfillTests). */
    static DataSource emptyDataSource() {
        PGSimpleDataSource dataSource = new PGSimpleDataSource();
        dataSource.setURL(POSTGRES.getJdbcUrl());
        dataSource.setUser(POSTGRES.getUsername());
        dataSource.setPassword(POSTGRES.getPassword());
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").cleanDisabled(false).load().clean();
        return dataSource;
    }
}
