package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.repository.AccountRepository;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.MediaStorage;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.web.servlet.MultipartProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.unit.DataSize;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class PostControllerMediaTest {

    private static final String POST_JSON = "{\"content\": \"Look at this image\", \"channel\": \"home\"}";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private MultipartProperties multipartProperties;

    @Autowired
    private MediaStorage mediaStorage;

    private AccountPrincipal principal;

    private Set<String> baselineStorageKeys;

    @BeforeEach
    void setUpAccount() {
        baselineStorageKeys = currentStorageKeys();
        Account account = accountRepository.insert("mediaposter", "Media Poster", "unused-hash");
        principal = new AccountPrincipal(account.id(), account.handle(), null);
    }

    @AfterEach
    void cleanStorageFiles() {
        for (String key : currentStorageKeys()) {
            if (!baselineStorageKeys.contains(key)) {
                mediaStorage.delete(key);
            }
        }
    }

    private Set<String> currentStorageKeys() {
        return new HashSet<>(jdbcClient.sql("SELECT storage_key FROM post_images")
                .query(String.class).list());
    }

    @Test
    void multipartCreateReturnsCreatedPostWithPublicImage() throws Exception {
        byte[] png = pngBytes(4, 3);

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", png))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value("Media Poster"))
                .andExpect(jsonPath("$.content").value("Look at this image"))
                .andExpect(jsonPath("$.channel").value("home"))
                .andExpect(jsonPath("$.image.id").isNumber())
                .andExpect(jsonPath("$.image.url").value(matchesPattern("/api/media/[0-9]+")))
                .andExpect(jsonPath("$.image.contentType").value("image/png"))
                .andExpect(jsonPath("$.image.width").value(4))
                .andExpect(jsonPath("$.image.height").value(3))
                .andExpect(jsonPath("$.image.byteSize").value(png.length))
                .andExpect(content().string(not(containsString("storageKey"))))
                .andExpect(content().string(not(containsString("sha256"))))
                .andExpect(content().string(not(containsString("photo.png"))));
    }

    @Test
    void multipartMissingPostPartReturnsMalformedRequest() throws Exception {
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(new MockMultipartFile("image", "photo.png", "image/png", pngBytes(2, 2)))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void multipartMissingImagePartReturnsMalformedRequest() throws Exception {
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void multipartMalformedPostJsonReturnsMalformedRequest() throws Exception {
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart("{invalid"))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", pngBytes(2, 2)))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void multipartInvalidPostFieldsReturnsValidationFailed() throws Exception {
        String body = "{\"content\": \"   \", \"channel\": \"home\"}";
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(body))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", pngBytes(2, 2)))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void multipartInvalidImageReturnsInvalidImage() throws Exception {
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .file(new MockMultipartFile("image", "photo.jpg", "image/jpeg",
                                "not a real image".getBytes()))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_IMAGE"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void multipartOversizedImageReturnsImageTooLarge() throws Exception {
        byte[] oversized = new byte[5 * 1024 * 1024 + 1];
        long postsBefore = countPosts();
        long imagesBefore = countImages();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", oversized))
                        .with(user(principal))
                        .with(csrf()))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("IMAGE_TOO_LARGE"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isEqualTo(imagesBefore);
    }

    @Test
    void jsonCreateStillReturnsNullImage() throws Exception {
        mockMvc.perform(post("/api/posts")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\": \"plain post\", \"channel\": \"home\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.image").value(nullValue()))
                .andExpect(jsonPath("$.content").value("plain post"));
    }

    @Test
    void anonymousMultipartCreateReturnsUnauthorizedAndNoRows() throws Exception {
        long postsBefore = countPosts();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", pngBytes(2, 2)))
                        .with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isZero();
    }

    @Test
    void authenticatedMultipartWithoutCsrfReturnsForbiddenAndNoRows() throws Exception {
        long postsBefore = countPosts();

        mockMvc.perform(multipart("/api/posts")
                        .file(postPart(POST_JSON))
                        .file(new MockMultipartFile("image", "photo.png", "image/png", pngBytes(2, 2)))
                        .with(user(principal)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_TOKEN_INVALID"));

        assertThat(countPosts()).isEqualTo(postsBefore);
        assertThat(countImages()).isZero();
    }

    @Test
    void multipartLimitsAreConfigured() {
        assertThat(multipartProperties.getMaxFileSize()).isEqualTo(DataSize.ofMegabytes(5));
        assertThat(multipartProperties.getMaxRequestSize()).isEqualTo(DataSize.ofMegabytes(6));
    }

    private static MockMultipartFile postPart(String json) {
        return new MockMultipartFile("post", "", MediaType.APPLICATION_JSON_VALUE,
                json.getBytes(StandardCharsets.UTF_8));
    }

    private long countPosts() {
        return jdbcClient.sql("SELECT COUNT(*) FROM posts").query(Long.class).single();
    }

    private long countImages() {
        return jdbcClient.sql("SELECT COUNT(*) FROM post_images").query(Long.class).single();
    }

    private static byte[] pngBytes(int width, int height) {
        try {
            BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (!ImageIO.write(image, "png", out)) {
                throw new IllegalStateException("Failed to write PNG bytes");
            }
            return out.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Failed to build PNG test image", exception);
        }
    }
}
