package dev.ojbk.console.security;

import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

public record Actor(String username, Set<Role> roles) {

    public static Actor from(Authentication authentication) {
        Set<Role> roles = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .filter(authority -> authority.startsWith("ROLE_"))
                .map(authority -> Role.valueOf(authority.substring(5)))
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
        return new Actor(authentication.getName(), roles);
    }

    public boolean isAdmin() {
        return roles.contains(Role.ADMIN);
    }

    public boolean isOps() {
        return roles.contains(Role.OPS);
    }

    public enum Role {
        ADMIN,
        OPS,
        USER
    }
}
