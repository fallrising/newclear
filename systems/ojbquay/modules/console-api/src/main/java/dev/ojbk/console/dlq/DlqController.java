package dev.ojbk.console.dlq;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.security.Actor;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions/{subscriptionId}/dlq")
public final class DlqController {
    private final DlqService dlq;

    DlqController(DlqService dlq) {
        this.dlq = dlq;
    }

    @GetMapping
    ApiResponse<List<DlqRecordView>> browse(
            @PathVariable long subscriptionId,
            @RequestParam(defaultValue = "50") int n,
            Authentication authentication) {
        return ApiResponse.ok(
                dlq.browse(subscriptionId, n, Actor.from(authentication)));
    }

    @PostMapping("/replay")
    ApiResponse<ReplayDlqResult> replay(
            @PathVariable long subscriptionId,
            @Valid @RequestBody ReplayDlqRequest request,
            Authentication authentication) {
        return ApiResponse.ok(
                dlq.replay(subscriptionId, request, Actor.from(authentication)));
    }
}
