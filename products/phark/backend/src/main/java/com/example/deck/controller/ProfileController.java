package com.example.deck.controller;

import com.example.deck.dto.UpdateProfileRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.AccountProfile;
import com.example.deck.model.PostPage;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.AccountService;
import com.example.deck.service.PostService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/profiles")
public class ProfileController {

    private final AccountService accountService;
    private final PostService postService;

    public ProfileController(AccountService accountService, PostService postService) {
        this.accountService = accountService;
        this.postService = postService;
    }

    @GetMapping("/{handle}")
    public AccountProfile getProfile(@PathVariable String handle) {
        return accountService.getProfileByHandle(handle);
    }

    @PatchMapping("/me")
    public AccountProfile updateProfile(
            @AuthenticationPrincipal AccountPrincipal principal,
            @RequestBody UpdateProfileRequest request) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        return accountService.updateProfile(
                principal.getAccountId(), request.displayName(), request.bio());
    }

    @GetMapping("/{handle}/posts")
    public PostPage getProfilePosts(
            @PathVariable String handle,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String before,
            @AuthenticationPrincipal AccountPrincipal principal,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
        long accountId = accountService.getAccountIdByHandle(handle);
        Long viewerAccountId = principal == null ? null : principal.getAccountId();
        return postService.getPostsByAccountId(accountId, limit, before, viewerAccountId);
    }
}
