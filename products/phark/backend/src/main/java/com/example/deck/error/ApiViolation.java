package com.example.deck.error;

public record ApiViolation(String field, String message) implements Comparable<ApiViolation> {

    @Override
    public int compareTo(ApiViolation o) {
        int cmp = this.field.compareTo(o.field);
        return cmp != 0 ? cmp : this.message.compareTo(o.message);
    }
}
