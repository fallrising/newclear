package com.example.deck.security;

import com.example.deck.error.ApiException;
import com.example.deck.model.Account;
import com.example.deck.repository.AccountRepository;
import com.example.deck.service.AccountService;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class AccountUserDetailsService implements UserDetailsService {

    private final AccountRepository accountRepository;
    private final AccountService accountService;

    public AccountUserDetailsService(
            AccountRepository accountRepository,
            AccountService accountService) {
        this.accountRepository = accountRepository;
        this.accountService = accountService;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        String canonicalHandle;
        try {
            canonicalHandle = accountService.canonicalizeHandle(username);
        } catch (ApiException exception) {
            throw new UsernameNotFoundException("Invalid credentials", exception);
        }

        Account account = accountRepository.findByHandle(canonicalHandle)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));

        return new AccountPrincipal(account.id(), account.handle(), account.passwordHash());
    }
}
