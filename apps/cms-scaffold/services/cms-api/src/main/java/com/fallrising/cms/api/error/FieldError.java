package com.fallrising.cms.api.error;

/**
 * One invalid input field (02 BD-08). field is a path: "payload.&lt;fieldKey&gt;" for an entry payload key.
 * message is an English developer message, not for display; clients show text chosen by code.
 */
public record FieldError(String field, FieldErrorCode code, String message) {}
