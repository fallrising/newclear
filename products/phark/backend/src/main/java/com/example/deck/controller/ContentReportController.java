package com.example.deck.controller;

import com.example.deck.dto.ContentReportResponse;
import com.example.deck.dto.CreateContentReportRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.ContentReportService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

@RestController
public class ContentReportController {
    private final ContentReportService reportService;
    private final ClientSignalHasher signalHasher;

    public ContentReportController(ContentReportService reportService, ClientSignalHasher signalHasher) {
        this.reportService = reportService;
        this.signalHasher = signalHasher;
    }

    @PostMapping("/api/posts/{postId}/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public ContentReportResponse reportPost(@PathVariable long postId,
                                            @AuthenticationPrincipal AccountPrincipal principal,
                                            @Valid @RequestBody CreateContentReportRequest request,
                                            HttpServletRequest servletRequest,
                                            HttpServletResponse response) {
        requirePrincipal(principal);
        String ipHmac = signalHasher.hashIp(servletRequest.getRemoteAddr());
        response.setHeader("Cache-Control", "private, no-store");
        return ContentReportResponse.from(
                reportService.reportPost(postId, principal.getAccountId(), request, ipHmac));
    }

    @PostMapping("/api/replies/{replyId}/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public ContentReportResponse reportReply(@PathVariable long replyId,
                                             @AuthenticationPrincipal AccountPrincipal principal,
                                             @Valid @RequestBody CreateContentReportRequest request,
                                             HttpServletRequest servletRequest,
                                             HttpServletResponse response) {
        requirePrincipal(principal);
        String ipHmac = signalHasher.hashIp(servletRequest.getRemoteAddr());
        response.setHeader("Cache-Control", "private, no-store");
        return ContentReportResponse.from(
                reportService.reportReply(replyId, principal.getAccountId(), request, ipHmac));
    }

    private void requirePrincipal(AccountPrincipal principal) {
        if (principal == null) throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
    }
}
