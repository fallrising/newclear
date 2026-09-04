package dev.ojbk.delay;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.UUID;
import java.util.random.RandomGenerator;

public final class Ids {
    private static final SecureRandom RANDOM = new SecureRandom();

    private Ids() {}

    public static String uuidV7() {
        return uuidV7(Clock.systemUTC(), RANDOM);
    }

    static String uuidV7(Clock clock, RandomGenerator random) {
        long timestamp = clock.millis() & 0x0000_FFFF_FFFF_FFFFL;
        long mostSignificant = (timestamp << 16) | 0x7000L | random.nextInt(1 << 12);
        long leastSignificant = random.nextLong();
        leastSignificant &= 0x3FFF_FFFF_FFFF_FFFFL;
        leastSignificant |= 0x8000_0000_0000_0000L;
        return new UUID(mostSignificant, leastSignificant).toString();
    }
}
