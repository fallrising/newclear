package com.example.deck.service;

public class ImageTooLargeException extends RuntimeException {

    public static final String DEFAULT_MESSAGE =
            "The uploaded image exceeds the maximum allowed size of 5 MiB.";

    public ImageTooLargeException() {
        super(DEFAULT_MESSAGE);
    }
}