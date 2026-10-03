package com.fallrising.cms.platform;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.TransactionDefinition;

import javax.sql.DataSource;
import java.util.function.Supplier;

/**
 * Runs work in one database transaction (02 BD-09): a state change and its audit event commit or roll back together.
 * With a DataSource, the JDBC stores' own TransactionTemplates join this transaction (same DataSource). Without one
 * (./gradlew test, in-memory stores) the work simply runs; in-memory stores have no rollback, so callers validate
 * before they write.
 */
@Component
public class TransactionRunner {

    private final TransactionTemplate template;
    private final TransactionTemplate independent;

    @Autowired
    public TransactionRunner(ObjectProvider<DataSource> dataSource) {
        this(dataSource.getIfAvailable());
    }

    public TransactionRunner(DataSource ds) {
        this.template = ds == null ? null : new TransactionTemplate(new DataSourceTransactionManager(ds));
        this.independent = ds == null ? null : new TransactionTemplate(new DataSourceTransactionManager(ds));
        if (independent != null) independent.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /** A runner without a database, for unit tests that build services by hand. */
    public static TransactionRunner withoutDatabase() {
        return new TransactionRunner((DataSource) null);
    }

    public <T> T inTransaction(Supplier<T> work) {
        return template == null ? work.get() : template.execute(status -> work.get());
    }

    /** Records rejected governance even if a caller has an outer transaction that will roll back. */
    public void independently(Runnable work) {
        if (independent == null) work.run();
        else independent.execute(status -> { work.run(); return null; });
    }

    public void run(Runnable work) {
        inTransaction(() -> {
            work.run();
            return null;
        });
    }
}
