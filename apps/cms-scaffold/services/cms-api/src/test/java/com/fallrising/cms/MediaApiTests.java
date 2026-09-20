package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class MediaApiTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String BACK = "http://localhost:5174";

    @Autowired
    MockMvc mockMvc;

    @Test
    void uploadAttachPublishThenPublicThumbnailAndUnpublishHidesFile() throws Exception {
        Session op = login("seed-operator-album");
        byte[] png = png();
        MvcResult upload = mockMvc.perform(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "shot.png", "image/png", png))
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").exists())
                .andExpect(jsonPath("$.variants.thumbnail.url").exists())
                .andReturn();
        String mediaId = id(upload);

        mockMvc.perform(get("/api/v1/public/media/" + mediaId + "/file/thumbnail"))
                .andExpect(status().isNotFound());

        String albumSlug = "media-" + UUID.randomUUID().toString().substring(0, 8);
        String albumId = createAlbum(op, albumSlug);
        MvcResult photo = mockMvc.perform(post("/api/v1/content-types/photo/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"title":"Shot","album":"%s","media":"%s","sortOrder":0}}
                                """.formatted(albumId, mediaId)))
                .andExpect(status().isCreated())
                .andReturn();
        String photoId = id(photo);

        mockMvc.perform(post("/api/v1/entries/" + albumId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/entries/" + photoId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/public/media/" + mediaId + "/file/thumbnail"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries/" + photoId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.media.variants.thumbnail.url").value(
                        "/api/v1/public/media/" + mediaId + "/file/thumbnail"));

        mockMvc.perform(post("/api/v1/entries/" + albumId + "/unpublish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/media/" + mediaId + "/file/thumbnail"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/media/" + mediaId + "/file/thumbnail")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk());
    }

    private String createAlbum(Session session, String slug) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/content-types/album/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie())
                        .content("""
                                {"slug":"%s","payload":{"title":"%s"}}
                                """.formatted(slug, slug)))
                .andExpect(status().isCreated())
                .andReturn();
        return id(result);
    }

    private Session login(String username) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        return new Session(cookie(result, "cms_session"), cookie(result, "cms_csrf"));
    }

    private static String id(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString().replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElse(null);
    }

    private static byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setColor(Color.RED);
        g.fillRect(0, 0, 16, 16);
        g.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
    }

    private record Session(String token, String csrf) {
        MockCookie sessionCookie() {
            MockCookie cookie = new MockCookie("cms_session", token);
            cookie.setPath("/");
            cookie.setHttpOnly(true);
            return cookie;
        }

        MockCookie csrfCookie() {
            MockCookie cookie = new MockCookie("cms_csrf", csrf);
            cookie.setPath("/");
            return cookie;
        }
    }
}
