package com.example.deck.service;

public class InvalidImageException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
            "The uploaded file is not a valid JPEG or PNG image.";

    public InvalidImageException() {
        super(DEFAULT_MESSAGE);
    }
}