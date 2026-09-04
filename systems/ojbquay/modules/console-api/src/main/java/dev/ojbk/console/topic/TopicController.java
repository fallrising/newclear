package dev.ojbk.console.topic;

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
@RequestMapping("/api/v1/topics")
public final class TopicController {
    private final TopicService topics;
    private final TopicWorkflowService workflows;

    TopicController(TopicService topics, TopicWorkflowService workflows) {
        this.topics = topics;
        this.workflows = workflows;
    }

    @GetMapping
    ApiResponse<List<TopicView>> list(Authentication authentication) {
        return ApiResponse.ok(topics.list(Actor.from(authentication)));
    }

    @PostMapping
    ResponseEntity<ApiResponse<TopicView>> create(
            @Valid @RequestBody CreateTopicRequest request, Authentication authentication) {
        TopicView created = topics.create(request, Actor.from(authentication));
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(created));
    }

    @GetMapping("/{id}/sample")
    ApiResponse<List<TopicSample>> sample(
            @PathVariable long id,
            @org.springframework.web.bind.annotation.RequestParam(
                            defaultValue = "10")
                    int n,
            @org.springframework.web.bind.annotation.RequestParam(
                            defaultValue = "false")
                    boolean redact,
            @org.springframework.web.bind.annotation.RequestParam(
                            defaultValue = "")
                    String cel,
            Authentication authentication) {
        return ApiResponse.ok(workflows.sample(
                id, n, redact, cel, Actor.from(authentication)));
    }

    @PostMapping("/{id}/test-message")
    ApiResponse<TestMessageResult> testMessage(
            @PathVariable long id,
            @Valid @RequestBody TestMessageRequest request,
            Authentication authentication) {
        return ApiResponse.ok(workflows.publish(
                id, request, Actor.from(authentication)));
    }

    @PutMapping("/{id}")
    ApiResponse<TopicView> update(
            @PathVariable long id,
            @Valid @RequestBody UpdateTopicRequest request,
            Authentication authentication) {
        return ApiResponse.ok(topics.update(id, request, Actor.from(authentication)));
    }

    @PostMapping("/{id}/state")
    ApiResponse<TopicView> changeState(
            @PathVariable long id,
            @RequestBody StateRequest request,
            Authentication authentication) {
        return ApiResponse.ok(topics.changeState(id, request.enabled(), Actor.from(authentication)));
    }

    @DeleteMapping("/{id}")
    ApiResponse<TopicView> delete(@PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(topics.delete(id, Actor.from(authentication)));
    }
}
