package dev.ojbk.sdk;

import ojbk.v1.Code;
import java.util.Objects;

public final class OjbkException extends RuntimeException {
    private static final long serialVersionUID = 1L;
    private final Code code;

    public OjbkException(Code code, String message) {
        super(message);
        this.code = Objects.requireNonNull(code, "code");
    }

    public OjbkException(Code code, String message, Throwable cause) {
        super(message, cause);
        this.code = Objects.requireNonNull(code, "code");
    }

    public Code code() {
        return code;
    }
}
