package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.domain.Surface;

public class IdentityRequest {

    public enum TokenState {
        NONE,
        VALID,
        EXPIRED,
        REVOKED
    }

    private String requestId;
    private Surface surface = Surface.FRONT;
    private Principal principal;
    private SessionRecord session;
    private boolean cookieAuth;
    private boolean bearerAuth;
    private TokenState tokenState = TokenState.NONE;
    private String origin;
    private String ip;
    private String userAgent;

    public String requestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public Surface surface() {
        return surface;
    }

    public void setSurface(Surface surface) {
        this.surface = surface;
    }

    public Principal principal() {
        return principal;
    }

    public void setPrincipal(Principal principal) {
        this.principal = principal;
    }

    public SessionRecord session() {
        return session;
    }

    public void setSession(SessionRecord session) {
        this.session = session;
    }

    public boolean cookieAuth() {
        return cookieAuth;
    }

    public void setCookieAuth(boolean cookieAuth) {
        this.cookieAuth = cookieAuth;
    }

    public boolean bearerAuth() {
        return bearerAuth;
    }

    public void setBearerAuth(boolean bearerAuth) {
        this.bearerAuth = bearerAuth;
    }

    public TokenState tokenState() {
        return tokenState;
    }

    public void setTokenState(TokenState tokenState) {
        this.tokenState = tokenState;
    }

    public String origin() {
        return origin;
    }

    public void setOrigin(String origin) {
        this.origin = origin;
    }

    public String ip() {
        return ip;
    }

    public void setIp(String ip) {
        this.ip = ip;
    }

    public String userAgent() {
        return userAgent;
    }

    public void setUserAgent(String userAgent) {
        this.userAgent = userAgent;
    }
}
