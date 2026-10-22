package dev.ojbk.console.group;

import dev.ojbk.config.RuntimePauseStatus;
import dev.ojbk.config.RuntimeRoster;
import dev.ojbk.console.api.ApiException;
import java.io.IOException;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public final class RuntimePauseVerifier {
    private final RuntimeRoster roster;
    private final Fetch fetch;

    @org.springframework.beans.factory.annotation.Autowired
    public RuntimePauseVerifier(@Value("${OJBQUAY_CONSUME_RUNTIME_ROSTER:}") String configuration) {
        this(RuntimeRoster.parse(configuration), http());
    }

    RuntimePauseVerifier(RuntimeRoster roster, Fetch fetch) { this.roster = roster; this.fetch = fetch; }
    public record Barrier(Map<String, String> boots) { public Barrier { boots = Map.copyOf(boots); } }

    public Barrier capture(long subscription, long deadline) {
        if (roster.endpoints().isEmpty()) throw unavailable();
        Map<String, String> boots = new LinkedHashMap<>();
        for (var entry : roster.endpoints().entrySet()) {
            RuntimePauseStatus status = read(entry.getKey(), entry.getValue(), subscription, deadline);
            boots.put(entry.getKey(), status.bootId());
        }
        return new Barrier(boots);
    }

    public boolean awaitPaused(Barrier barrier, long subscription, long revision, long deadline) {
        if (!barrier.boots().keySet().equals(roster.endpoints().keySet()) || barrier.boots().isEmpty())
            throw unavailable();
        while (System.nanoTime() < deadline) {
            boolean confirmed = true;
            for (var entry : roster.endpoints().entrySet()) {
                RuntimePauseStatus status = read(entry.getKey(), entry.getValue(), subscription, deadline);
                if (!barrier.boots().get(entry.getKey()).equals(status.bootId())) throw unavailable();
                confirmed &= status.revision() == revision && status.paused()
                        && status.fetchStopped() && status.inflightSettled();
            }
            if (confirmed) { remaining(deadline); return true; }
            try { Thread.sleep(Math.min(25, Math.max(1, remaining(deadline).toMillis()))); }
            catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw unavailable(); }
        }
        return false;
    }

    private RuntimePauseStatus read(String id, URI endpoint, long subscription, long deadline) {
        try {
            RuntimePauseStatus status = fetch.get(endpoint.resolve("/internal/pause-status?subscriptionId="
                    + subscription), remaining(deadline));
            remaining(deadline);
            if (!id.equals(status.instanceId()) || status.bootId() == null || status.bootId().isBlank()
                    || !roster.fingerprint().equals(status.rosterFingerprint())
                    || status.subscriptionId() != subscription || !status.bootstrapComplete()) throw unavailable();
            return status;
        } catch (RuntimeException failure) { throw unavailable(); }
    }

    static Duration remaining(long deadline) {
        long left = deadline - System.nanoTime();
        if (left <= 0) throw unavailable();
        return Duration.ofNanos(left);
    }
    private static ApiException unavailable() {
        return new ApiException("RUNTIME_PAUSE_UNCONFIRMED", HttpStatus.CONFLICT,
                "every configured runtime must confirm the same paused revision and process identity");
    }
    @FunctionalInterface interface Fetch { RuntimePauseStatus get(URI uri, Duration remaining); }
    static Fetch http() {
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2))
                .followRedirects(HttpClient.Redirect.NEVER).build();
        return (uri, remaining) -> {
            try {
                Duration timeout = remaining.compareTo(Duration.ofSeconds(2)) < 0 ? remaining : Duration.ofSeconds(2);
                var response = client.send(HttpRequest.newBuilder(uri).timeout(timeout).GET().build(),
                        ignored -> limitedBody());
                if (response.statusCode() != 200) throw unavailable();
                return RuntimePauseStatus.fromJson(response.body());
            } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw unavailable(); }
            catch (java.io.IOException failure) { throw unavailable(); }
        };
    }
    private static HttpResponse.BodySubscriber<String> limitedBody() {
        var delegate = HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8);
        return new HttpResponse.BodySubscriber<>() {
            private Flow.Subscription subscription;
            private int bytes;
            private boolean rejected;
            public CompletionStage<String> getBody() { return delegate.getBody(); }
            public void onSubscribe(Flow.Subscription value) {
                subscription = value;
                delegate.onSubscribe(value);
            }
            public void onNext(List<ByteBuffer> buffers) {
                if (rejected) return;
                for (var buffer : buffers) {
                    if (buffer.remaining() > 4096 - bytes) {
                        rejected = true;
                        subscription.cancel();
                        delegate.onError(new IOException("runtime status exceeds 4096 bytes"));
                        return;
                    }
                    bytes += buffer.remaining();
                }
                delegate.onNext(buffers);
            }
            public void onError(Throwable failure) { if (!rejected) delegate.onError(failure); }
            public void onComplete() { if (!rejected) delegate.onComplete(); }
        };
    }

}
