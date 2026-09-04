package dev.ojbk.console.subscription;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.api.StateRequest;
import dev.ojbk.console.security.Actor;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions")
public final class SubscriptionController {
    private final SubscriptionService subscriptions;
    private final SubscriptionPreviewService previews;

    SubscriptionController(
            SubscriptionService subscriptions,
            SubscriptionPreviewService previews) {
        this.subscriptions = subscriptions;
        this.previews = previews;
    }

    @GetMapping
    ApiResponse<List<SubscriptionView>> list(Authentication authentication) {
        return ApiResponse.ok(subscriptions.list(Actor.from(authentication)));
    }

    @PostMapping
    ResponseEntity<ApiResponse<SubscriptionView>> create(
            @Valid @RequestBody CreateSubscriptionRequest request,
            Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(
                        subscriptions.create(request, Actor.from(authentication))));
    }

    @PostMapping("/preview")
    ApiResponse<SubscriptionPreview> preview(
            @Valid @RequestBody PreviewSubscriptionRequest request) {
        return ApiResponse.ok(previews.preview(request));
    }

    @PutMapping("/{id}")
    ApiResponse<SubscriptionView> update(
            @PathVariable long id,
            @Valid @RequestBody UpdateSubscriptionRequest request,
            Authentication authentication) {
        return ApiResponse.ok(subscriptions.update(id, request, Actor.from(authentication)));
    }

    @PostMapping("/{id}/state")
    ApiResponse<SubscriptionView> changeState(
            @PathVariable long id,
            @RequestBody StateRequest request,
            Authentication authentication) {
        return ApiResponse.ok(
                subscriptions.changeState(id, request.enabled(), Actor.from(authentication)));
    }

    @DeleteMapping("/{id}")
    ApiResponse<SubscriptionView> delete(
            @PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(subscriptions.delete(id, Actor.from(authentication)));
    }
}
