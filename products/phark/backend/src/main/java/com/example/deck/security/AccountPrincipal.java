package com.example.deck.security;

import java.util.Collection;
import java.util.Collections;
import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public final class AccountPrincipal implements UserDetails, CredentialsContainer {

    private final long accountId;
    private final String handle;
    private String passwordHash;

    public AccountPrincipal(long accountId, String handle, String passwordHash) {
        this.accountId = accountId;
        this.handle = handle;
        this.passwordHash = passwordHash;
    }

    public long getAccountId() {
        return accountId;
    }

    public String getHandle() {
        return handle;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return Collections.emptyList();
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return handle;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    @Override
    public void eraseCredentials() {
        this.passwordHash = null;
    }

    @Override
    public String toString() {
        return "AccountPrincipal{accountId=" + accountId + ", handle='" + handle + "'}";
    }
}
