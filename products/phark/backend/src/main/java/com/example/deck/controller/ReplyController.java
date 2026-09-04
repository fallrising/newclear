package com.example.deck.controller;

import com.example.deck.dto.CreateReplyRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Reply;
import com.example.deck.model.ReplyPage;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.ReplyService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/posts/{postId}/replies")
public class ReplyController {

    private final ReplyService replyService;
    private final ClientSignalHasher signalHasher;

    public ReplyController(ReplyService replyService, ClientSignalHasher signalHasher) {
        this.replyService = replyService;
        this.signalHasher = signalHasher;
    }

    @GetMapping
    public ReplyPage getReplies(
            @PathVariable long postId,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String after) {
        return replyService.getReplies(postId, limit, after);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Reply createReply(
            @PathVariable long postId,
            @AuthenticationPrincipal AccountPrincipal principal,
            @Valid @RequestBody CreateReplyRequest request,
            HttpServletRequest servletRequest) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        String ipHmac = signalHasher.hashIp(servletRequest.getRemoteAddr());
        return replyService.createReply(
                postId, principal.getAccountId(), request, ipHmac);
    }
}
