package com.example.deck.controller;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.RepostState;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.PostRepostService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/posts/{postId}/repost")
public class PostRepostController {

    private final PostRepostService postRepostService;

    public PostRepostController(PostRepostService postRepostService) {
        this.postRepostService = postRepostService;
    }

    @PutMapping
    public RepostState repost(
            @PathVariable long postId,
            @AuthenticationPrincipal AccountPrincipal principal) {
        return postRepostService.repost(postId, accountId(principal));
    }

    @DeleteMapping
    public RepostState unrepost(
            @PathVariable long postId,
            @AuthenticationPrincipal AccountPrincipal principal) {
        return postRepostService.unrepost(postId, accountId(principal));
    }

    private long accountId(AccountPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        return principal.getAccountId();
    }
}
