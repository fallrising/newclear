package dev.ojbk.observability;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

public final class MetricsHttp implements AutoCloseable {
    private final HttpServer server;
    private final ExecutorService executor;
    private final AtomicBoolean ready = new AtomicBoolean();
    private final Supplier<String> metrics;

    public MetricsHttp(int port, Supplier<String> metrics) {
        this(new InetSocketAddress("127.0.0.1", port), metrics);
    }

    public MetricsHttp(InetSocketAddress address, Supplier<String> metrics) {
        this.metrics = metrics;
        try {
            server = HttpServer.create(address, 0);
        } catch (IOException exception) {
            throw new IllegalStateException("metrics server cannot bind", exception);
        }
        executor = Executors.newVirtualThreadPerTaskExecutor();
        server.setExecutor(executor);
        server.createContext("/livez", exchange -> respond(exchange, 200, "UP\n"));
        server.createContext(
                "/readyz",
                exchange -> respond(exchange, ready.get() ? 200 : 503, ready.get() ? "UP\n" : "DOWN\n"));
        server.createContext("/metrics", exchange -> respond(exchange, 200, metrics.get()));
    }

    public void start() {
        server.start();
    }

    public int port() {
        return server.getAddress().getPort();
    }

    public void setReady(boolean value) {
        ready.set(value);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (exchange; var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @Override
    public void close() {
        server.stop(0);
        executor.close();
    }
}
