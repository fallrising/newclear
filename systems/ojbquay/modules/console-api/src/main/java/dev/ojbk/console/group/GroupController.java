package dev.ojbk.console.group;

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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/groups")
public final class GroupController {
    private final GroupService groups;
    private final GroupWorkflowService workflows;

    GroupController(GroupService groups, GroupWorkflowService workflows) {
        this.groups = groups;
        this.workflows = workflows;
    }

    @GetMapping
    ApiResponse<List<GroupView>> list(Authentication authentication) {
        return ApiResponse.ok(groups.list(Actor.from(authentication)));
    }

    @PostMapping
    ResponseEntity<ApiResponse<GroupView>> create(
            @Valid @RequestBody CreateGroupRequest request, Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(groups.create(request, Actor.from(authentication))));
    }

    @GetMapping("/{id}/progress")
    ApiResponse<List<GroupTopicProgress>> progress(
            @PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(workflows.progress(
                id, Actor.from(authentication)));
    }

    @PostMapping("/{id}/reset-offset")
    ApiResponse<GroupOffsetReset> resetOffset(
            @PathVariable long id,
            @Valid @RequestBody ResetOffsetRequest request,
            Authentication authentication) {
        return ApiResponse.ok(workflows.reset(
                id, request, Actor.from(authentication)));
    }

    @PostMapping("/{id}/state")
    ApiResponse<GroupView> changeState(
            @PathVariable long id,
            @RequestBody StateRequest request,
            Authentication authentication) {
        return ApiResponse.ok(groups.changeState(id, request.enabled(), Actor.from(authentication)));
    }

    @DeleteMapping("/{id}")
    ApiResponse<GroupView> delete(@PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(groups.delete(id, Actor.from(authentication)));
    }
}
