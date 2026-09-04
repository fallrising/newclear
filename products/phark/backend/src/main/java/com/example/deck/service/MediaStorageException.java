package com.example.deck.service;

/**
 * Signals that a media storage operation could not be completed safely.
 * Messages never include internal filesystem paths or storage keys.
 */
public class MediaStorageException extends RuntimeException {

    public MediaStorageException(String message) {
        super(message);
    }

    public MediaStorageException(String message, Throwable cause) {
        super(message, cause);
    }
}