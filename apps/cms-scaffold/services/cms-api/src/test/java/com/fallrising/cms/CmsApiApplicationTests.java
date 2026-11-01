package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootVersion;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CmsApiApplicationTests {

    @Test
    void pp1cExactOfflineTokenNeverStartsSpring() {
        var calls = new java.util.ArrayList<String>();
        Integer exit = CmsApiApplication.dispatch(new String[]{"ops-inventory", "--request", "/run/pp1/request.json"},
                args -> calls.add("spring"), args -> { calls.add("maintenance"); return 9; },
                args -> { calls.add(String.join(" ", args)); return 0; });
        assertThat(exit).isZero();
        assertThat(calls).containsExactly("--request /run/pp1/request.json");
    }

    @Test
    void pp1cMisplacedOrRepeatedOfflineTokensNeverStartSpring() {
        for (String[] input : new String[][]{{"x", "ops-inventory"}, {"ops-inventory", "ops-inventory"},
                {"x", "ops-revoke-restored-sessions"}, {"ops-revoke-restored-sessions"}}) {
            var calls = new java.util.ArrayList<String>();
            Integer exit = CmsApiApplication.dispatch(input, args -> calls.add("spring"),
                    args -> { calls.add("maintenance"); return 9; },
                    args -> { calls.add("inventory"); return 0; });
            assertThat(exit).isEqualTo(2);
            assertThat(calls).isEmpty();
        }
    }

    @Test
    void pp1cPreservesLegacyMaintenancePriorityAndMisplacedRejection() {
        for (String[] input : new String[][]{{"maintenance", "fresh-init"}, {"ops-inventory", "maintenance"}}) {
            var calls = new java.util.ArrayList<String>();
            Integer exit = CmsApiApplication.dispatch(input, args -> calls.add("spring"),
                    args -> { calls.add(String.join(" ", args)); return 6; },
                    args -> { calls.add("inventory"); return 0; });
            assertThat(exit).isEqualTo(6);
            assertThat(calls).containsExactly(input[0].equals("maintenance") ? "fresh-init" : "");
        }
    }

    @Test
    void pp1cNormalStartupStillReachesSpring() {
        var calls = new java.util.ArrayList<String>();
        assertThat(CmsApiApplication.dispatch(new String[]{"--server.port=0"}, args -> calls.add(args[0]),
                args -> 9, args -> 8)).isNull();
        assertThat(calls).containsExactly("--server.port=0");
    }

    @Autowired
    MockMvc mockMvc;

    @Test
    void contextLoads() {
    }

    @Test
    void healthIsUp() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void openApiShellIsServed() throws Exception {
        mockMvc.perform(get("/openapi.yaml"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("CMS Scaffold API")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("/actuator/health")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("/api/v1/public")));
    }

    @Test
    void flywayBaselineHasNoBusinessTables() throws Exception {
        String sql = new ClassPathResource("db/migration/V1__wave_a_baseline.sql")
                .getContentAsString(StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT)
                .replaceAll("(?m)--.*$", "");
        assertThat(sql).contains("create extension");
        assertThat(sql).doesNotContain(
                "create table cms_entry",
                "create table cms_principal",
                "create table cms_media",
                "create table cms_content_type",
                "create table album",
                "create table photo");
    }

    @Test
    void flywayIdentityTablesAreSystemOnly() throws Exception {
        String sql = new ClassPathResource("db/migration/V2__identity.sql")
                .getContentAsString(StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT)
                .replaceAll("(?m)--.*$", "");
        assertThat(sql).contains("create table cms_principal");
        assertThat(sql).contains("create table cms_role");
        assertThat(sql).contains("create table cms_permission");
        assertThat(sql).contains("create table cms_session");
        assertThat(sql).doesNotContain("create table cms_entry", "create table cms_media", "create table album");
    }

    @Test
    void flywayContentTablesAreSystemOnly() throws Exception {
        String sql = new ClassPathResource("db/migration/V3__content.sql")
                .getContentAsString(StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT)
                .replaceAll("(?m)--.*$", "");
        assertThat(sql).contains("create table cms_entry");
        assertThat(sql).contains("create table cms_content_type");
        assertThat(sql).doesNotContain("create table album", "create table photo", "create table cms_media");
    }

    @Test
    void runtimeIsJava25() {
        assertThat(Runtime.version().feature()).isEqualTo(25);
    }

    @Test
    void springBootIsAtLeast35() {
        String version = SpringBootVersion.getVersion();
        assertThat(version).isNotBlank();
        String[] parts = version.split("\\.");
        assertThat(Integer.parseInt(parts[0])).isEqualTo(3);
        assertThat(Integer.parseInt(parts[1])).isGreaterThanOrEqualTo(5);
    }
}
