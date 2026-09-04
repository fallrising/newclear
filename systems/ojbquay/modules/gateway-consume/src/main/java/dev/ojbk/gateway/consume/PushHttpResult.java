package dev.ojbk.gateway.consume;

public record PushHttpResult(
        boolean success,
        int statusCode,
        int attempts,
        boolean transportFailure) {

    public PushHttpResult {
        if (statusCode < 0 || statusCode > 599) {
            throw new IllegalArgumentException("statusCode must be 0..599");
        }
        if (attempts < 1 || attempts > 3) {
            throw new IllegalArgumentException("attempts must be 1..3");
        }
    }

    public static PushHttpResult http(int statusCode, int attempts) {
        return new PushHttpResult(
                statusCode >= 200 && statusCode < 300,
                statusCode,
                attempts,
                false);
    }

    public static PushHttpResult transportFailure(int attempts) {
        return new PushHttpResult(false, 0, attempts, true);
    }
}
