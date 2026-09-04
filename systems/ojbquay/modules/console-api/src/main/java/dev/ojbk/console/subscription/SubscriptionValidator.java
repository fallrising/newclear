package dev.ojbk.console.subscription;

import dev.ojbk.config.DeliveryPolicy;
import dev.ojbk.config.PullSubscriptionSpec;
import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.pipeline.CelFilter;
import dev.ojbk.pipeline.TransitMapper;
import jakarta.annotation.PreDestroy;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public final class SubscriptionValidator {
    private static final Set<String> MODES = Set.of("PUSH", "PULL");
    private final CelFilter celFilter = new CelFilter();
    private final TransitMapper transitMapper = new TransitMapper();

    public void validate(Map<String, Object> spec) {
        String mode = string(spec, "mode");
        if (!MODES.contains(mode)) {
            throw new IllegalArgumentException("spec.mode must be PUSH or PULL");
        }
        DeliveryPolicy policy = "PUSH".equals(mode)
                ? PushSubscriptionSpec.from(spec)
                : PullSubscriptionSpec.from(spec);
        celFilter.validate(policy.filterCel());
        transitMapper.validate(policy.transit());
    }

    private static String string(Map<String, Object> value, String field) {
        Object raw = value.get(field);
        if (!(raw instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("spec." + field + " must be a non-blank string");
        }
        return text;
    }

    @PreDestroy
    void close() {
        celFilter.close();
    }
}
