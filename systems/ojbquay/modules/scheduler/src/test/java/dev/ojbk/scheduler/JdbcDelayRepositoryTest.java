package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.ojbk.delay.DelayAction;
import dev.ojbk.delay.DelayCommand;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
final class JdbcDelayRepositoryTest {
    private static final Instant DUE = Instant.parse("2026-07-29T12:00:00Z");

    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:17");

    private static DataSource dataSource;
    private JdbcDelayRepository repository;

    @BeforeAll
    static void createSchema() throws Exception {
        PGSimpleDataSource postgres = new PGSimpleDataSource();
        postgres.setURL(POSTGRES.getJdbcUrl());
        postgres.setUser(POSTGRES.getUsername());
        postgres.setPassword(POSTGRES.getPassword());
        dataSource = postgres;
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE delay_message (
                      delay_id TEXT PRIMARY KEY,
                      target_topic TEXT NOT NULL,
                      due_at TIMESTAMPTZ NOT NULL,
                      payload BYTEA NOT NULL,
                      headers JSONB NOT NULL DEFAULT '{}',
                      msg_key TEXT,
                      loop_interval_ms BIGINT,
                      loop_remaining INT,
                      expire_at TIMESTAMPTZ,
                      status SMALLINT NOT NULL DEFAULT 0,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      fired_at TIMESTAMPTZ
                    )
                    """);
            statement.execute("""
                    CREATE INDEX idx_delay_due
                      ON delay_message (due_at)
                      WHERE status = 0
                    """);
        }
    }

    @BeforeEach
    void reset() throws Exception {
        repository = new JdbcDelayRepository(dataSource);
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute("TRUNCATE delay_message");
        }
    }

    @Test
    void duplicateAddCreatesOnePendingSeries() throws Exception {
        DelayCommand add = add("delay-1", DUE, null, 1, null);

        repository.applyBatch(List.of(add, add));
        repository.applyBatch(List.of(add));

        assertThat(rowCount()).isEqualTo(1);
        assertThat(status("delay-1")).isEqualTo(DelayStatus.PENDING);
        assertThat(repository.pendingCount()).isEqualTo(1);
    }

    @Test
    void hundredMillisecondTicksFireAfterDueAndWithinOneSecond() throws Exception {
        Instant due = Instant.now().plusMillis(300);
        repository.applyBatch(List.of(add("delay-accuracy", due, null, 1, null)));
        AtomicReference<Instant> firedAt = new AtomicReference<>();

        assertThat(repository.dispatchDue(
                        due.minusMillis(1),
                        500,
                        ignored -> firedAt.set(Instant.now())))
                .isZero();
        Instant deadline = due.plusSeconds(1);
        while (firedAt.get() == null && Instant.now().isBefore(deadline)) {
            repository.dispatchDue(
                    Instant.now(), 500, ignored -> firedAt.set(Instant.now()));
            if (firedAt.get() == null) {
                Thread.sleep(100);
            }
        }

        assertThat(firedAt.get()).isNotNull().isBetween(due, deadline);
    }

    @Test
    void cancelWinsBeforeDispatch() throws Exception {
        repository.applyBatch(List.of(
                add("delay-1", DUE, null, 1, null),
                DelayCommand.cancel("delay-1", "orders")));
        List<DelayDelivery> sent = new ArrayList<>();

        int dispatched = repository.dispatchDue(DUE.plusSeconds(1), 500, sent::add);

        assertThat(dispatched).isZero();
        assertThat(sent).isEmpty();
        assertThat(status("delay-1")).isEqualTo(DelayStatus.CANCELED);
    }

    @Test
    void advancesAThreeOccurrenceSeriesAndPreservesMetadata() throws Exception {
        repository.applyBatch(List.of(add(
                "delay-1", DUE, 1_000L, 3, DUE.plusSeconds(10))));
        List<DelayDelivery> sent = new ArrayList<>();

        assertThat(repository.dispatchDue(DUE, 500, sent::add)).isEqualTo(1);
        assertThat(repository.dispatchDue(DUE.plusSeconds(1), 500, sent::add))
                .isEqualTo(1);
        assertThat(repository.dispatchDue(DUE.plusSeconds(2), 500, sent::add))
                .isEqualTo(1);

        assertThat(sent).hasSize(3).allSatisfy(delivery -> {
            assertThat(delivery.delayId()).isEqualTo("delay-1");
            assertThat(delivery.topic()).isEqualTo("orders");
            assertThat(delivery.tags()).containsExactly("paid");
            assertThat(delivery.headers()).containsEntry("traceparent", "00-test");
            assertThat(delivery.partition()).isEqualTo(1);
        });
        assertThat(status("delay-1")).isEqualTo(DelayStatus.DONE);
    }

    @Test
    void sendFailureRollsBackPendingStateForRetry() throws Exception {
        repository.applyBatch(List.of(add("delay-1", DUE, null, 1, null)));

        assertThatThrownBy(() -> repository.dispatchDue(DUE, 500, ignored -> {
                    throw new IllegalStateException("Kafka unavailable");
                }))
                .isInstanceOf(DelayDispatchException.class);

        assertThat(status("delay-1")).isEqualTo(DelayStatus.PENDING);
    }

    @Test
    void concurrentWorkersDoNotClaimTheSameLockedRow() throws Exception {
        repository.applyBatch(List.of(add("delay-1", DUE, null, 1, null)));
        CountDownLatch sendStarted = new CountDownLatch(1);
        CountDownLatch allowSend = new CountDownLatch(1);

        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Integer> first = workers.submit(() -> repository.dispatchDue(DUE, 500, ignored -> {
                sendStarted.countDown();
                await(allowSend);
            }));
            assertThat(sendStarted.await(5, TimeUnit.SECONDS)).isTrue();

            Future<Integer> second =
                    workers.submit(() -> repository.dispatchDue(DUE, 500, ignored -> {}));
            assertThat(second.get(5, TimeUnit.SECONDS)).isZero();
            allowSend.countDown();
            assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo(1);
        }

        assertThat(status("delay-1")).isEqualTo(DelayStatus.DONE);
    }

    @Test
    void cancellationWaitsForLockedOccurrenceThenStopsTheRemainingSeries()
            throws Exception {
        repository.applyBatch(List.of(add(
                "delay-1", DUE, 1_000L, 3, DUE.plusSeconds(10))));
        CountDownLatch sendStarted = new CountDownLatch(1);
        CountDownLatch allowSend = new CountDownLatch(1);

        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Integer> dispatch =
                    workers.submit(() -> repository.dispatchDue(DUE, 500, ignored -> {
                        sendStarted.countDown();
                        await(allowSend);
                    }));
            assertThat(sendStarted.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> cancel = workers.submit(() -> repository.applyBatch(
                    List.of(DelayCommand.cancel("delay-1", "orders"))));

            assertThat(cancel.isDone()).isFalse();
            allowSend.countDown();
            assertThat(dispatch.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            cancel.get(5, TimeUnit.SECONDS);
        }

        assertThat(status("delay-1")).isEqualTo(DelayStatus.CANCELED);
        assertThat(repository.dispatchDue(DUE.plusSeconds(1), 500, ignored -> {}))
                .isZero();
    }

    @Test
    void expiresAndCleansTerminalRowsInBoundedBatches() throws Exception {
        repository.applyBatch(List.of(add(
                "delay-expired", DUE, null, 1, DUE.plusMillis(1))));

        assertThat(repository.dispatchDue(DUE.plusSeconds(1), 500, ignored -> {}))
                .isZero();
        assertThat(status("delay-expired")).isEqualTo(DelayStatus.EXPIRED);
        assertThat(repository.cleanupTerminal(DUE.plusSeconds(2), 1)).isEqualTo(1);
        assertThat(rowCount()).isZero();
    }

    private static DelayCommand add(
            String id,
            Instant due,
            Long intervalMs,
            int remaining,
            Instant expireAt) {
        return new DelayCommand(
                1,
                DelayAction.ADD,
                id,
                "orders",
                due.toEpochMilli(),
                "value".getBytes(StandardCharsets.UTF_8),
                "order-1",
                List.of("paid"),
                Map.of("traceparent", "00-test"),
                1,
                intervalMs,
                remaining,
                expireAt == null ? null : expireAt.toEpochMilli());
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("test latch timed out");
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("test interrupted", interrupted);
        }
    }

    private static long rowCount() throws Exception {
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("SELECT count(*) FROM delay_message")) {
            result.next();
            return result.getLong(1);
        }
    }

    private static DelayStatus status(String delayId) throws Exception {
        try (Connection connection = dataSource.getConnection();
                var statement = connection.prepareStatement(
                        "SELECT status FROM delay_message WHERE delay_id = ?")) {
            statement.setString(1, delayId);
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return DelayStatus.fromCode(result.getShort(1));
            }
        }
    }
}
