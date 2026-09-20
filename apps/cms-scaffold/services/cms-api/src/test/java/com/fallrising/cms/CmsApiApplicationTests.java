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
