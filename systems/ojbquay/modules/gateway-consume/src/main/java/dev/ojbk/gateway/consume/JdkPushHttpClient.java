package dev.ojbk.gateway.consume;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ThreadLocalRandom;

public final class JdkPushHttpClient implements PushHttpClient {
    private static final List<Duration> FAST_BACKOFFS =
            List.of(Duration.ofMillis(200), Duration.ofMillis(400));

    private final Exchange exchange;
    private final Sleeper sleeper;
    private final UrlSelector urlSelector;

    public JdkPushHttpClient() {
        HttpClient client = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.exchange = request -> client.send(
                        request, HttpResponse.BodyHandlers.discarding())
                .statusCode();
        this.sleeper = Thread::sleep;
        this.urlSelector = urls ->
                URI.create(urls.get(ThreadLocalRandom.current().nextInt(urls.size())));
    }

    JdkPushHttpClient(Exchange exchange, Sleeper sleeper, UrlSelector urlSelector) {
        this.exchange = Objects.requireNonNull(exchange, "exchange");
        this.sleeper = Objects.requireNonNull(sleeper, "sleeper");
        this.urlSelector = Objects.requireNonNull(urlSelector, "urlSelector");
    }

    @Override
    public PushHttpResult deliver(PushRequest request) {
        Objects.requireNonNull(request, "request");
        int attempts = 0;
        while (attempts < 3) {
            attempts++;
            HttpRequest httpRequest = request(request, urlSelector.select(request.urls()));
            try {
                return PushHttpResult.http(exchange.send(httpRequest), attempts);
            } catch (IOException transport) {
                if (attempts >= 3) {
                    return PushHttpResult.transportFailure(attempts);
                }
                try {
                    sleeper.sleep(FAST_BACKOFFS.get(attempts - 1));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return PushHttpResult.transportFailure(attempts);
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return PushHttpResult.transportFailure(attempts);
            }
        }
        throw new IllegalStateException("unreachable push retry state");
    }

    private static HttpRequest request(PushRequest request, URI uri) {
        HttpRequest.Builder builder =
                HttpRequest.newBuilder(uri).timeout(request.timeout());
        request.headers().forEach(builder::header);
        HttpRequest.BodyPublisher body = "GET".equals(request.method())
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofByteArray(request.body());
        return builder.method(request.method(), body).build();
    }

    @FunctionalInterface
    interface Exchange {
        int send(HttpRequest request) throws IOException, InterruptedException;
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration) throws InterruptedException;
    }

    @FunctionalInterface
    interface UrlSelector {
        URI select(List<String> urls);
    }
}
