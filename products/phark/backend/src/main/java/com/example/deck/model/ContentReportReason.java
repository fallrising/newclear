package com.example.deck.model;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum ContentReportReason {
    SPAM,
    HARASSMENT,
    HATE_OR_VIOLENCE,
    SEXUAL_CONTENT,
    OTHER;

    @JsonCreator
    public static ContentReportReason fromJson(String value) {
        if (value == null) {
            return null;
        }
        for (ContentReportReason reason : values()) {
            if (reason.name().equals(value)) {
                return reason;
            }
        }
        return null;
    }
}
