package com.example.deck.controller;

import com.example.deck.dto.CreatePostRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Post;
import com.example.deck.model.PostPage;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.PostService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/posts")
public class PostController {

    private final PostService postService;
    private final ClientSignalHasher signalHasher;

    public PostController(PostService postService, ClientSignalHasher signalHasher) {
        this.postService = postService;
        this.signalHasher = signalHasher;
    }

    @GetMapping
    public PostPage getPosts(
            @RequestParam(required = false) String channel,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String before,
            @AuthenticationPrincipal AccountPrincipal principal,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
        Long viewerAccountId = principal == null ? null : principal.getAccountId();
        return postService.getPosts(channel, limit, before, viewerAccountId);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Post createPost(
            @AuthenticationPrincipal AccountPrincipal principal,
            @Valid @RequestBody CreatePostRequest request,
            HttpServletRequest servletRequest) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        String ipHmac = signalHasher.hashIp(servletRequest.getRemoteAddr());
        return postService.createPost(principal.getAccountId(), request, ipHmac);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Post createPostWithImage(
            @AuthenticationPrincipal AccountPrincipal principal,
            @Valid @RequestPart("post") CreatePostRequest request,
            @RequestPart("image") MultipartFile image,
            HttpServletRequest servletRequest) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        String ipHmac = signalHasher.hashIp(servletRequest.getRemoteAddr());
        return postService.createPostWithImage(
                principal.getAccountId(), request, image, ipHmac);
    }
}
