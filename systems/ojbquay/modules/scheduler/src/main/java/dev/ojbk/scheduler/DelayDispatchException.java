package dev.ojbk.scheduler;

public final class DelayDispatchException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public DelayDispatchException(String message, Throwable cause) {
        super(message, cause);
    }
}
