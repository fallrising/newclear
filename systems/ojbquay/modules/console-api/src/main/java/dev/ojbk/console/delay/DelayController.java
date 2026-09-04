package dev.ojbk.console.delay;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.security.Actor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/delay")
public final class DelayController {
    private final DelayService delays;

    DelayController(DelayService delays) {
        this.delays = delays;
    }

    @GetMapping("/{delayId}")
    ApiResponse<DelayView> get(
            @PathVariable String delayId, Authentication authentication) {
        return ApiResponse.ok(
                delays.get(delayId, Actor.from(authentication)));
    }

    @PostMapping("/{delayId}/cancel")
    ApiResponse<DelayView> cancel(
            @PathVariable String delayId, Authentication authentication) {
        return ApiResponse.ok(
                delays.cancel(delayId, Actor.from(authentication)));
    }
}
