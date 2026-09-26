package com.fallrising.cms.support;

import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A logged-in seed account for MockMvc tests. The password comes from cms.identity.seed-password. */
public record TestSession(String origin, String token, String csrf) {

    public static final String FRONT = "http://localhost:5173";
    public static final String BACK = "http://localhost:5174";
    public static final String ADMIN = "http://localhost:5175";

    public static TestSession login(MockMvc mockMvc, String username, String password, String origin) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", origin)
                        .content("{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password)))
                .andExpect(status().isOk())
                .andReturn();
        return new TestSession(origin, cookie(result, "cms_session"), cookie(result, "cms_csrf"));
    }

    /** Adds Origin, both cookies and the CSRF header. */
    public MockHttpServletRequestBuilder apply(MockHttpServletRequestBuilder request) {
        MockCookie session = new MockCookie("cms_session", token);
        session.setPath("/");
        session.setHttpOnly(true);
        MockCookie csrfCookie = new MockCookie("cms_csrf", csrf);
        csrfCookie.setPath("/");
        return request.header("Origin", origin).header("X-CSRF-Token", csrf).cookie(session, csrfCookie);
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElseThrow();
    }
}
