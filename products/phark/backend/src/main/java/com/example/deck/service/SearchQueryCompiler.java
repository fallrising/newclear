package com.example.deck.service;

import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class SearchQueryCompiler {

    private static final int MAX_CODE_POINTS = 100;
    private static final int MAX_TERMS = 8;

    public String compile(String query) {
        if (query == null) {
            throw invalidQuery();
        }
        String trimmed = stripUnicodeWhitespace(query);
        int pointCount = trimmed.codePointCount(0, trimmed.length());
        if (pointCount < 1 || pointCount > MAX_CODE_POINTS) {
            throw invalidQuery();
        }

        for (int i = 0; i < trimmed.length(); i += Character.charCount(trimmed.codePointAt(i))) {
            int codePoint = trimmed.codePointAt(i);
            if (isIsoControl(codePoint) && !isUnicodeWhitespace(codePoint)) {
                throw invalidQuery();
            }
        }

        List<String> terms = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (int i = 0; i < trimmed.length(); i += Character.charCount(trimmed.codePointAt(i))) {
            int codePoint = trimmed.codePointAt(i);
            if (isUnicodeWhitespace(codePoint)) {
                if (current.length() > 0) {
                    terms.add(current.toString());
                    current.setLength(0);
                }
            } else {
                current.appendCodePoint(codePoint);
            }
        }
        if (current.length() > 0) {
            terms.add(current.toString());
        }

        if (terms.isEmpty() || terms.size() > MAX_TERMS) {
            throw invalidQuery();
        }

        List<String> phrases = new ArrayList<>();
        for (String term : terms) {
            String escaped = term.replace("\"", "\"\"");
            boolean hasLetterOrDigit = false;
            for (int i = 0; i < escaped.length(); i += Character.charCount(escaped.codePointAt(i))) {
                if (Character.isLetterOrDigit(escaped.codePointAt(i))) {
                    hasLetterOrDigit = true;
                    break;
                }
            }
            if (!hasLetterOrDigit) {
                throw invalidQuery();
            }
            phrases.add("\"" + escaped + "\"");
        }

        return String.join(" AND ", phrases);
    }

    private static boolean isUnicodeWhitespace(int codePoint) {
        if ((codePoint >= 0x09 && codePoint <= 0x0D) || codePoint == 0x0085) {
            return true;
        }
        return switch (Character.getType(codePoint)) {
            case Character.LINE_SEPARATOR,
                    Character.PARAGRAPH_SEPARATOR,
                    Character.SPACE_SEPARATOR -> true;
            default -> false;
        };
    }

    private static String stripUnicodeWhitespace(String value) {
        int start = 0;
        int end = value.length();
        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!isUnicodeWhitespace(codePoint)) {
                break;
            }
            start += Character.charCount(codePoint);
        }
        while (start < end) {
            int codePoint = value.codePointBefore(end);
            if (!isUnicodeWhitespace(codePoint)) {
                break;
            }
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    private static boolean isIsoControl(int codePoint) {
        return codePoint < 0x20 || (codePoint >= 0x7F && codePoint <= 0x9F);
    }

    private IllegalArgumentException invalidQuery() {
        return new IllegalArgumentException("Invalid search query");
    }
}
