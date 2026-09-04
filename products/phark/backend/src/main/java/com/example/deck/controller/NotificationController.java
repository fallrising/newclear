package com.example.deck.controller;

import com.example.deck.dto.MarkNotificationsReadRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.NotificationPage;
import com.example.deck.model.NotificationReadState;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.NotificationService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public NotificationPage getNotifications(
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String before,
            @AuthenticationPrincipal AccountPrincipal principal,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
        return notificationService.getNotifications(accountId(principal), limit, before);
    }

    @PutMapping("/read")
    public NotificationReadState markRead(
            @AuthenticationPrincipal AccountPrincipal principal,
            @Valid @RequestBody MarkNotificationsReadRequest request) {
        return notificationService.markRead(accountId(principal), request.through());
    }

    private long accountId(AccountPrincipal principal) {
        if (principal == null) {
            throw new ApiException(ApiErrorCode.AUTHENTICATION_REQUIRED);
        }
        return principal.getAccountId();
    }
}
