package dev.ojbk.gateway.consume;

@FunctionalInterface
public interface PushHttpClient {
    PushHttpResult deliver(PushRequest request);
}
