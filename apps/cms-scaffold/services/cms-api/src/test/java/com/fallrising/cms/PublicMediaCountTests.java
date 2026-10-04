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

/**
 * 02 BQ-11 and §5.4: a public list whose entries carry media-ref values makes the same content-store and media-store
 * calls for 1 item as for 3 (media are resolved for the whole page at once).
 */
@SpringBootTest
@AutoConfigureMockMvc
class PublicMediaCountTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @MockitoSpyBean
    ContentStore contentStore;

    @MockitoSpyBean
    MediaStore mediaStore;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ11_publicListWithMediaStoreCallsDoNotGrowWithItems() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String album = api.create(op, "album", Map.of("title", ApiFixture.token("Media "))).get("id").asText();
        api.action(op, album, "publish").andExpect(status().isOk());
        for (int i = 0; i < 3; i++) {
            String media = mapper.readTree(mockMvc.perform(op.apply(multipart("/api/v1/media")
                            .file(new MockMultipartFile("file", "p" + i + ".png", "image/png", png()))))
                    .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
            String photo = api.create(op, "photo", Map.of("title", "P" + i, "album", album, "media", media, "sortOrder", i))
                    .get("id").asText();
            api.action(op, photo, "publish").andExpect(status().isOk());
        }

        Calls one = calls(get("/api/v1/public/content-types/photo/entries").param("ref.album", album).param("size", "1"), 1);
        Calls three = calls(get("/api/v1/public/content-types/photo/entries").param("ref.album", album).param("size", "3"), 3);
        assertThat(three.content()).isEqualTo(one.content());
        assertThat(three.media()).isEqualTo(one.media());
        assertThat(one.media()).containsExactly("findAll", "attachmentsOfMedia");
    }

    record Calls(List<String> content, List<String> media) {}

    private Calls calls(MockHttpServletRequestBuilder request, int items) throws Exception {
        Mockito.clearInvocations(contentStore, mediaStore);
        mockMvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(items))
                .andExpect(jsonPath("$.items[" + (items - 1) + "].payload.media.variants.thumbnail.url").exists());
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
