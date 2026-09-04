package com.example.deck.dto;

public record LoginRequest(String handle, String password) {

    @Override
    public String toString() {
        return "LoginRequest[handle=" + handle + ", password=<redacted>]";
    }
}
