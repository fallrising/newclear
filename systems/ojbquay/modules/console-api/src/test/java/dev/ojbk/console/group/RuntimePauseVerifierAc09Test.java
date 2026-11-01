package dev.ojbk.console.group;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import dev.ojbk.config.RuntimePauseStatus;
import dev.ojbk.config.RuntimeRoster;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class RuntimePauseVerifierAc09Test {
    private static final RuntimeRoster ROSTER = RuntimeRoster.parse("one=http://one:9202;two=http://two:9202");
    @Test void AC_09_allDistinctRuntimesConfirmExactRevisionAndBoot() {
        var verifier = new RuntimePauseVerifier(ROSTER, (uri, left) -> status(uri.getHost(), "boot", 4, true));
        long deadline = deadline();
        var barrier = verifier.capture(1, deadline);
        assertThat(verifier.awaitPaused(barrier, 1, 4, deadline)).isTrue();
    }
    @Test void AC_09_missingOrUnknownRuntimeNeverCountsAsConfirmation() {
        var verifier = new RuntimePauseVerifier(ROSTER, (uri, left) -> {
            if (uri.getHost().equals("two")) throw new IllegalStateException("unavailable");
            return status("one", "boot", 4, true);
        });
        assertThatThrownBy(() -> verifier.capture(1, deadline())).isInstanceOf(dev.ojbk.console.api.ApiException.class);
        var unknown = new RuntimePauseVerifier(ROSTER, (uri, left) -> status("unknown", "boot", 4, true));
        assertThatThrownBy(() -> unknown.capture(1, deadline())).isInstanceOf(dev.ojbk.console.api.ApiException.class);
    }
    @Test void AC_09_changedBootOrIncompleteRosterFailsClosed() {
        AtomicReference<String> boot = new AtomicReference<>("old");
        var verifier = new RuntimePauseVerifier(ROSTER, (uri, left) -> status(uri.getHost(), boot.get(), 4, true));
        var barrier = verifier.capture(1, deadline()); boot.set("new");
        assertThatThrownBy(() -> verifier.awaitPaused(barrier, 1, 4, deadline()))
                .isInstanceOf(dev.ojbk.console.api.ApiException.class);
        assertThatThrownBy(() -> verifier.awaitPaused(new RuntimePauseVerifier.Barrier(Map.of("one", "new")),
                1, 4, deadline())).isInstanceOf(dev.ojbk.console.api.ApiException.class);
    }
    @Test void AC_09_unresolvedInflightOrWrongRevisionCannotConfirm() {
        for (boolean settled : new boolean[] {true, false}) {
            var verifier = new RuntimePauseVerifier(ROSTER, (uri, left) -> status(uri.getHost(), "boot", settled ? 3 : 4, settled));
            var barrier = verifier.capture(1, deadline());
            boolean confirmed;
            try { confirmed = verifier.awaitPaused(barrier, 1, 4,
                    System.nanoTime() + Duration.ofMillis(10).toNanos()); }
            catch (dev.ojbk.console.api.ApiException failure) { confirmed = false; }
            assertThat(confirmed).isFalse();
        }
    }
    @Test void AC_09_responseCompletingAfterDeadlineCannotConfirm() {
        var delayed = new java.util.concurrent.atomic.AtomicBoolean();
        var verifier = new RuntimePauseVerifier(ROSTER, (uri, left) -> {
            if (delayed.get()) {
                try { Thread.sleep(20); }
                catch (InterruptedException interrupted) { throw new IllegalStateException(interrupted); }
            }
            return status(uri.getHost(), "boot", 4, true);
        });
        var barrier = verifier.capture(1, deadline());
        delayed.set(true);
        assertThatThrownBy(() -> verifier.awaitPaused(barrier, 1, 4,
                System.nanoTime() + Duration.ofMillis(5).toNanos()))
                .isInstanceOf(dev.ojbk.console.api.ApiException.class);
    }
    @Test void AC_09_httpStatusBodyHasHardByteLimit() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = new byte[8192];
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) { output.write(body); }
        });
        server.start();
        try {
            var uri = java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/");
            assertThatThrownBy(() -> RuntimePauseVerifier.http().get(uri, Duration.ofSeconds(1)))
                    .isInstanceOf(dev.ojbk.console.api.ApiException.class);
        } finally { server.stop(0); }
    }
    @Test void AC_09_httpResponseBodyRemainsWithinRequestDeadline() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.sendResponseHeaders(200, 1024);
            try {
                Thread.sleep(1000);
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            finally { exchange.close(); }
        });
        server.start();
        try {
            var uri = java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/");
            long started = System.nanoTime();
            assertThatThrownBy(() -> RuntimePauseVerifier.http().get(uri, Duration.ofMillis(100)))
                    .isInstanceOf(dev.ojbk.console.api.ApiException.class);
            assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(750));
        } finally { server.stop(0); }
    }
    private static long deadline() { return System.nanoTime() + Duration.ofSeconds(1).toNanos(); }
    private static RuntimePauseStatus status(String id, String boot, long revision, boolean settled) {
        return new RuntimePauseStatus(id, boot, ROSTER.fingerprint(), 1, revision, true, true, settled, true);
    }
}
