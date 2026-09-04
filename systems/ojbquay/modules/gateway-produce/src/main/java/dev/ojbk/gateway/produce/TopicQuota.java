package dev.ojbk.gateway.produce;

import java.util.LinkedHashMap;
import java.util.Map;

final class TopicQuota {
    private static final int MAX_TOPICS = 10_000;
    private final Map<String, Bucket> buckets =
            new LinkedHashMap<>(128, 0.75f, true);

    synchronized boolean tryConsume(String topic, int rate, long nowMillis) {
        Bucket bucket = buckets.get(topic);
        if (bucket == null || bucket.rate != rate) {
            bucket = new Bucket(rate, nowMillis);
            buckets.put(topic, bucket);
            evictIfNeeded();
        }
        return bucket.tryConsume(nowMillis);
    }

    private void evictIfNeeded() {
        while (buckets.size() > MAX_TOPICS) {
            String eldest = buckets.keySet().iterator().next();
            buckets.remove(eldest);
        }
    }

    private static final class Bucket {
        private final int rate;
        private double available;
        private long lastRefillMillis;

        private Bucket(int rate, long nowMillis) {
            this.rate = rate;
            this.available = rate;
            this.lastRefillMillis = nowMillis;
        }

        private boolean tryConsume(long nowMillis) {
            long elapsedMillis = Math.max(0, nowMillis - lastRefillMillis);
            if (elapsedMillis > 0) {
                available = Math.min(rate, available + elapsedMillis * rate / 1_000.0);
                lastRefillMillis = nowMillis;
            }
            if (available < 1) {
                return false;
            }
            available -= 1;
            return true;
        }
    }
}
