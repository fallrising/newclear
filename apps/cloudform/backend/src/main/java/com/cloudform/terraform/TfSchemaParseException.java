package com.cloudform.terraform;

public class TfSchemaParseException extends RuntimeException {
    public TfSchemaParseException(String message, Throwable cause) {
        super(message, cause);
    }

    public TfSchemaParseException(String message) {
        super(message);
    }
}
