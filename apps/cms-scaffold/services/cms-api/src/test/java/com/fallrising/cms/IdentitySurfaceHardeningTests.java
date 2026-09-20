package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class IdentitySurfaceHardeningTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String BACK = "http://localhost:5174";

    @Autowired MockMvc mockMvc;

    @Test
    void cookieWithoutOriginCannotPromoteSurfaceWithHeader() throws Exception {
        Session session = login("seed-admin", BACK);
        mockMvc.perform(get("/api/v1/principals")
                        .header("X-CMS-Surface", "admin")
                        .cookie(session.sessionCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }

    @Test
    void bearerWithoutOriginMaySpecifyContractSurface() throws Exception {
        Session session = login("seed-admin", BACK);
        mockMvc.perform(get("/api/v1/principals")
                        .header("Authorization", "Bearer " + session.token)
                        .header("X-CMS-Surface", "admin"))
                .andExpect(status().isOk());
    }

    private Session login(String username, String origin) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", origin)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        return new Session(cookie(result, "cms_session"));
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst().orElseThrow();
    }

    private record Session(String token) {
        MockCookie sessionCookie() {
            MockCookie cookie = new MockCookie("cms_session", token);
            cookie.setPath("/");
            cookie.setHttpOnly(true);
            return cookie;
        }
    }
}
