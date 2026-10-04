package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-04: GET /principals/assignable. */
@SpringBootTest
@AutoConfigureMockMvc
class AssignablePrincipalsApiTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G04_listsActivePrincipalsWithUpdateOnTheType() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "album")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].displayName").value(hasItems("Album editor", "Album operator")))
                .andExpect(jsonPath("$.items[*].displayName").value(not(hasItem("Clinic operator"))))
                .andExpect(jsonPath("$.items[0].username").doesNotExist());
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "album").param("q", "EDITOR-ALB")))
                .andExpect(jsonPath("$.items[*].displayName").value(equalTo(List.of("Album editor"))));
    }

    @Test
    void G04_rejectsMissingOrUnknownTypesAndCallersWithoutUpdate() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(op.apply(get("/api/v1/principals/assignable").param("contentType", "nope")))
                .andExpect(status().isBadRequest());
        TestSession clinic = TestSession.login(mockMvc, "seed-editor-clinic", password, TestSession.BACK);
        mockMvc.perform(clinic.apply(get("/api/v1/principals/assignable").param("contentType", "album")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }
}
