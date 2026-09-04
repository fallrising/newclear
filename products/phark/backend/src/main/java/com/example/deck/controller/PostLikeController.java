package com.example.deck.controller;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.LikeState;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.PostLikeService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/posts/{postId}/like")
public class PostLikeController {

    private final PostLikeService postLikeService;

    public PostLikeController(PostLikeService postLikeService) {
        this.postLikeService = postLikeService;
    }

    @PutMapping
    public LikeState like(
            @PathVariable long postId,
            @AuthenticationPrincipal AccountPrincipal principal) {
        return postLikeService.like(postId, accountId(principal));
    }

    @DeleteMapping
    public LikeState unlike(
            @PathVariable long postId,
            @AuthenticationPrincipal AccountPrincipal principal) {
        return postLikeService.unlike(postId, accountId(principal));
    }

    private long accountId(AccountPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        return principal.getAccountId();
    }
}
