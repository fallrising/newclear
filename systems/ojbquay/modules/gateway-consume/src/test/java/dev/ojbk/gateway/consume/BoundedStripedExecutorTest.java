package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

final class BoundedStripedExecutorTest {
    @Test
    void serializesSameKeyAndAllowsAnotherStripeToProgress() throws Exception {
        List<String> events = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch firstStarted = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch otherFinished = new CountDownLatch(1);

        try (BoundedStripedExecutor executor = new BoundedStripedExecutor(2, 4)) {
            var first = executor.submit("a", () -> {
                events.add("a1-start");
                firstStarted.countDown();
                releaseFirst.await();
                events.add("a1-end");
                return true;
            });
            assertThat(firstStarted.await(2, TimeUnit.SECONDS)).isTrue();

            var second = executor.submit("a", () -> {
                events.add("a2");
                return true;
            });
            var other = executor.submit("b", () -> {
                events.add("b");
                otherFinished.countDown();
                return true;
            });

            assertThat(otherFinished.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(events).containsExactly("a1-start", "b");
            releaseFirst.countDown();

            assertThat(first.get(2, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(2, TimeUnit.SECONDS)).isTrue();
            assertThat(other.get(2, TimeUnit.SECONDS)).isTrue();
            assertThat(events).containsExactly("a1-start", "b", "a1-end", "a2");
        }
    }
}
