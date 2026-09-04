package com.example.deck.controller;

import com.example.deck.dto.RegisterAccountRequest;
import com.example.deck.model.AccountProfile;
import com.example.deck.service.AccountService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final AccountService accountService;

    public AccountController(AccountService accountService) {
        this.accountService = accountService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AccountProfile register(@RequestBody RegisterAccountRequest request) {
        return accountService.register(
                request.handle(),
                request.displayName(),
                request.password());
    }
}
