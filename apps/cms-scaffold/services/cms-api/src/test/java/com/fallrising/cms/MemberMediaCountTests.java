package com.fallrising.cms;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.media.store.MediaStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.invocation.Invocation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The member page expands public media in one batch and never exposes a working-only replacement. */
@SpringBootTest
@AutoConfigureMockMvc
class MemberMediaCountTests {
    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper mapper;
    @MockitoSpyBean ContentStore contentStore;
    @MockitoSpyBean MediaStore mediaStore;
    @Value("${cms.identity.seed-password}") String password;

    @Test
    void memberMediaStoreCallsDoNotGrowFromOneToThreeItems() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession member = member(api);
        TestSession operator = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        String memberId = api.json(mockMvc.perform(member.apply(get("/api/v1/auth/me")))).at("/principal/id").asText();
        String owner = api.create(operator, "owner", Map.of("title", ApiFixture.token("Owner"))).get("id").asText();
        String token = ApiFixture.token("MemberMedia");
        for (int i = 0; i < 3; i++) {
            String media = upload(operator);
            String pet = api.create(operator, "pet", Map.of("title", token + i, "owner", owner,
                    "ownerPrincipalId", memberId, "photo", Map.of("mediaId", media))).get("id").asText();
            api.action(operator, pet, "publish").andExpect(status().isOk());
        }
        Calls one = calls(member.apply(get("/api/v1/me/content-types/pet/entries").param("q", token).param("size", "1")), 1);
        Calls three = calls(member.apply(get("/api/v1/me/content-types/pet/entries").param("q", token).param("size", "3")), 3);
        assertThat(three.content()).isEqualTo(one.content());
        assertThat(three.media()).isEqualTo(one.media());
        assertThat(one.media()).containsExactly("findAll", "attachmentsOfMedia");
        assertThat(one.content().stream().filter("findEntries"::equals).count()).isEqualTo(2);
        Mockito.clearInvocations(contentStore, mediaStore);
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries").param("q", ApiFixture.token("Missing"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
        assertThat(names(mediaStore)).isEmpty();
    }

    @Test
    void workingReplacementIsNullInMemberListAndSingleEntryUntilPublished() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession member = member(api);
        String memberId = api.json(mockMvc.perform(member.apply(get("/api/v1/auth/me")))).at("/principal/id").asText();
        TestSession operator = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        String owner = api.create(operator, "owner", Map.of("title", ApiFixture.token("Owner"))).get("id").asText();
        String title = ApiFixture.token("Replacement");
        String pet = api.create(operator, "pet", Map.of("title", title, "owner", owner, "ownerPrincipalId", memberId,
                "photo", upload(operator))).get("id").asText();
        api.action(operator, pet, "publish").andExpect(status().isOk());
        String replacement = upload(operator);
        api.patchEntry(operator, pet, api.work(operator, pet).get("version").asInt(), Map.of("photo", Map.of("mediaId", replacement)))
                .andExpect(status().isOk());
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries").param("q", title)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].payload.photo").isEmpty());
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", pet)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.payload.photo").isEmpty());
        api.action(operator, pet, "publish").andExpect(status().isOk());
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries").param("q", title)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].payload.photo.mediaId").value(replacement));
    }

    private TestSession member(ApiFixture api) throws Exception {
        return api.principalWithRole(TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN),
                "member", List.of(), TestSession.FRONT);
    }

    private String upload(TestSession operator) throws Exception {
        return mapper.readTree(mockMvc.perform(operator.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "pet.png", "image/png", png()))))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
    }

    record Calls(List<String> content, List<String> media) {}

    private Calls calls(MockHttpServletRequestBuilder request, int items) throws Exception {
        Mockito.clearInvocations(contentStore, mediaStore);
        mockMvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(items))
                .andExpect(jsonPath("$.items[" + (items - 1) + "].payload.photo.variants.thumbnail.url").exists());
        return new Calls(names(contentStore), names(mediaStore));
    }

    private static List<String> names(Object spy) {
        return Mockito.mockingDetails(spy).getInvocations().stream().map(Invocation::getMethod).map(m -> m.getName()).toList();
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
}
