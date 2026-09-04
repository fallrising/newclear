package dev.ojbk.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;

final class MetricsHttpTest {

    @Test
    void exposesLivenessReadinessAndMetricsWithoutPayloads() throws Exception {
        try (MetricsHttp server = new MetricsHttp(0, () -> "sample_total 1\n")) {
            server.start();
            HttpClient client = HttpClient.newHttpClient();

            assertThat(get(client, server.port(), "/livez").statusCode()).isEqualTo(200);
            assertThat(get(client, server.port(), "/readyz").statusCode()).isEqualTo(503);
            server.setReady(true);
            assertThat(get(client, server.port(), "/readyz").statusCode()).isEqualTo(200);
            assertThat(get(client, server.port(), "/metrics").body())
                    .isEqualTo("sample_total 1\n");
        }
    }

    private static HttpResponse<String> get(HttpClient client, int port, String path)
            throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + port + path))
                .GET()
                .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
