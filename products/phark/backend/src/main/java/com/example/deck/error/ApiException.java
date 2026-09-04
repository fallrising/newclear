package com.example.deck.error;

import java.util.Objects;

public class ApiException extends RuntimeException {

    private final ApiErrorCode code;
    private final String detail;

    public ApiException(ApiErrorCode code) {
        this(code, defaultDetail(code), null);
    }

    public ApiException(ApiErrorCode code, Throwable cause) {
        this(code, defaultDetail(code), cause);
    }

    public ApiException(ApiErrorCode code, String detail) {
        this(code, detail, null);
    }

    private ApiException(ApiErrorCode code, String detail, Throwable cause) {
        super(Objects.requireNonNull(detail, "detail"), cause);
        this.code = Objects.requireNonNull(code, "code");
        this.detail = detail;
    }

    private static String defaultDetail(ApiErrorCode code) {
        return Objects.requireNonNull(code, "code").getDefaultDetail();
    }

    public ApiErrorCode getCode() {
        return code;
    }

    public String getDetail() {
        return detail;
    }
}
