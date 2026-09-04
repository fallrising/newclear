package com.example.deck.controller;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.PostPage;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.SearchService;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/search")
public class SearchController {

    private final SearchService searchService;

    public SearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    @GetMapping
    public PostPage search(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "20") String limit,
            @RequestParam(required = false) String before,
            @AuthenticationPrincipal AccountPrincipal principal,
            HttpServletResponse response) {
        response.setHeader("Cache-Control", "private, no-store");
        Long viewerAccountId = principal == null ? null : principal.getAccountId();
        return searchService.search(q, parseLimit(limit), before, viewerAccountId);
    }

    private int parseLimit(String limit) {
        try {
            return Integer.parseInt(limit);
        } catch (NumberFormatException exception) {
            throw new ApiException(
                    ApiErrorCode.INVALID_LIMIT, "Limit must be between 1 and 50.");
        }
    }
}
