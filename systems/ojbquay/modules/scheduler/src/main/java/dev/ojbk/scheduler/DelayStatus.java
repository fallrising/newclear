package dev.ojbk.scheduler;

public enum DelayStatus {
    PENDING((short) 0),
    DONE((short) 1),
    CANCELED((short) 2),
    EXPIRED((short) 3);

    private final short code;

    DelayStatus(short code) {
        this.code = code;
    }

    short code() {
        return code;
    }

    public static DelayStatus fromCode(short code) {
        return switch (code) {
            case 0 -> PENDING;
            case 1 -> DONE;
            case 2 -> CANCELED;
            case 3 -> EXPIRED;
            default -> throw new IllegalArgumentException("unknown delay status: " + code);
        };
    }
}
