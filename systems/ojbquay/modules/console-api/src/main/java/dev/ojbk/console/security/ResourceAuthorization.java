package dev.ojbk.console.security;

import dev.ojbk.console.api.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public final class ResourceAuthorization {

    public void requireOwnerOrAdmin(String owner, Actor actor) {
        if (!actor.isAdmin() && !owner.equals(actor.username())) {
            throw new ApiException(
                    "FORBIDDEN", HttpStatus.FORBIDDEN, "resource is owned by another user");
        }
    }

    public void requireOperator(Actor actor) {
        if (!actor.isAdmin() && !actor.isOps()) {
            throw new ApiException(
                    "FORBIDDEN", HttpStatus.FORBIDDEN, "operator role is required");
        }
    }

    public void requireAdmin(Actor actor) {
        if (!actor.isAdmin()) {
            throw new ApiException(
                    "FORBIDDEN",
                    HttpStatus.FORBIDDEN,
                    "administrator role is required");
        }
    }
}
