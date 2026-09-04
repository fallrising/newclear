package com.example.deck.dto;

public record RegisterAccountRequest(String handle, String displayName, String password) {

    @Override
    public String toString() {
        return "RegisterAccountRequest[handle=" + handle
                + ", displayName=" + displayName
                + ", password=<redacted>]";
    }
}
