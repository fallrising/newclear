package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CapabilitiesTests {

    static final List<String> ALL_TYPE_ACTIONS =
            List.of("read_published", "read_draft", "create", "update", "publish", "unpublish", "delete", "archive");

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G01_operatorOnBackGetsAllActionsOnAllowlistedTypes() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/auth/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.surface").value("back"))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions").value(hasItem(ALL_TYPE_ACTIONS)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='photo')].actions").value(hasItem(ALL_TYPE_ACTIONS)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].scoped").value(hasItem(false)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='page')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("pet"))))
                .andExpect(jsonPath("$.capabilities.global").value(equalTo(List.of("manage_media"))));
    }

    @Test
    void G01_editorCannotPublish() throws Exception {
        TestSession editor = TestSession.login(mockMvc, "seed-editor-album", password, TestSession.BACK);
        mockMvc.perform(editor.apply(get("/api/v1/auth/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions")
                        .value(hasItem(List.of("read_published", "read_draft", "create", "update"))));
    }

    @Test
    void G01_frontHardDenyIsApplied() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(op.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.surface").value("front"))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.global").value(empty()));
    }

    @Test
    void G01_memberPredicateGrantsAreScoped() throws Exception {
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(member.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='pet')].actions").value(hasItem(List.of("read_published"))))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='pet')].scoped").value(hasItem(true)))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='album')].scoped").value(hasItem(false)))
                .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("issue"))));
    }

    @Test
    void G01_adminGovernanceOnlyOnAdminSurface() throws Exception {
        TestSession onAdmin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(onAdmin.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.global")
                        .value(equalTo(List.of("manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit"))));
        TestSession onBack = TestSession.login(mockMvc, "seed-admin", password, TestSession.BACK);
        mockMvc.perform(onBack.apply(get("/api/v1/auth/me")))
                .andExpect(jsonPath("$.capabilities.global").value(equalTo(List.of("manage_media"))))
                .andExpect(jsonPath("$.capabilities.types[?(@.key=='visit')].actions").value(hasItem(ALL_TYPE_ACTIONS)));
    }

    @Test
    void G01_disabledTypeIsNotListed() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/page/disable"))).andExpect(status().isOk());
        try {
            mockMvc.perform(admin.apply(get("/api/v1/auth/me")))
                    .andExpect(jsonPath("$.capabilities.types[*].key").value(not(hasItem("page"))));
        } finally {
            mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/page/enable"))).andExpect(status().isOk());
        }
    }

    @Test
    void G01_loginResponseCarriesCapabilities() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", TestSession.BACK)
                        .content("{\"username\":\"seed-editor-album\",\"password\":\"%s\"}".formatted(password)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.capabilities.surface").value("back"))
                .andExpect(jsonPath("$.capabilities.types[0].key").value("album"));
    }
}
