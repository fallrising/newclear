package com.cloudform.dto;

import java.util.Map;

public record ApiError(String code, String message, Map<String, Object> details) {

    public static ApiError of(String code, String message) {
        return new ApiError(code, message, null);
    }

    public static ApiError of(String code, String message, Map<String, Object> details) {
        return new ApiError(code, message, details);
    }
}
