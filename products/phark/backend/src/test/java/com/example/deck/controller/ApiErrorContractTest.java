package com.example.deck.controller;

import static org.hamcrest.MatcherAssert.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.repository.PostRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
@Import(ApiErrorContractTest.FailingController.class)
class ApiErrorContractTest {

    private static final String PROBLEM_JSON = "application/problem+json";
    private static final String VALID_REQUEST_ID = "my-test-id-42";
    private static final String UUID_REGEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PostRepository postRepository;

    private long validPostId;

    @BeforeEach
    void setUp() {
        validPostId = postRepository.findPage(null, 1, null).get(0).id();
    }

    @Test
    void validationFailedReturnsProblemDetails() throws Exception {
        String body = """
                {"content": "   ", "channel": "home"}
                """;

        mockMvc.perform(post("/api/posts")
                        .with(user("test"))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(problemDetails(
                        400, "validation-failed", "Validation failed",
                        "VALIDATION_FAILED", "/api/posts"))
                .andExpect(jsonPath("$.detail")
                        .value("One or more request fields are invalid."))
                .andExpect(jsonPath("$.violations").isArray())
                .andExpect(jsonPath("$.violations.length()").value(1))
                .andExpect(jsonPath("$.violations[0].field").value("content"))
                .andExpect(jsonPath("$.violations[0].message").value("content must not be blank"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"news", ""})
    void invalidChannelReturnsProblemDetails(String channel) throws Exception {
        mockMvc.perform(get("/api/posts").param("channel", channel))
                .andExpect(problemDetails(
                        400, "invalid-channel", "Invalid channel",
                        "INVALID_CHANNEL", "/api/posts"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101"})
    void invalidLimitOutOfRangeReturnsProblemDetails(String limit) throws Exception {
        mockMvc.perform(get("/api/posts").param("limit", limit))
                .andExpect(problemDetails(
                        400, "invalid-limit", "Invalid limit",
                        "INVALID_LIMIT", "/api/posts"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidLimitNonNumericReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/posts").param("limit", "abc"))
                .andExpect(problemDetails(
                        400, "invalid-limit", "Invalid limit",
                        "INVALID_LIMIT", "/api/posts"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidCursorReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/posts").param("before", "invalid"))
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", "/api/posts"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidReplyCursorReturnsProblemDetails() throws Exception {
        String path = "/api/posts/" + validPostId + "/replies";
        mockMvc.perform(get(path).param("after", "invalid"))
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", path))
                .andExpect(jsonPath("$.detail").isString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1"})
    void invalidPostIdNonPositiveReturnsProblemDetails(String postId) throws Exception {
        String path = "/api/posts/" + postId + "/replies";
        mockMvc.perform(get(path))
                .andExpect(problemDetails(
                        400, "invalid-post-id", "Invalid post ID",
                        "INVALID_POST_ID", path))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidPostIdNonNumericReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/posts/abc/replies"))
                .andExpect(problemDetails(
                        400, "invalid-post-id", "Invalid post ID",
                        "INVALID_POST_ID", "/api/posts/abc/replies"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void postNotFoundReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/posts/999999999/replies"))
                .andExpect(problemDetails(
                        404, "post-not-found", "Post not found",
                        "POST_NOT_FOUND", "/api/posts/999999999/replies"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void malformedJsonReturnsProblemDetails() throws Exception {
        mockMvc.perform(post("/api/posts")
                        .with(user("test"))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{invalid"))
                .andExpect(problemDetails(
                        400, "malformed-request", "Malformed request",
                        "MALFORMED_REQUEST", "/api/posts"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void unsupportedMediaTypeReturnsProblemDetails() throws Exception {
        mockMvc.perform(post("/api/posts")
                        .with(user("test"))
                        .with(csrf())
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("not json"))
                .andExpect(problemDetails(
                        415, "unsupported-media-type", "Unsupported media type",
                        "UNSUPPORTED_MEDIA_TYPE", "/api/posts"))
                .andExpect(header().string(
                        HttpHeaders.ACCEPT, containsString(MediaType.APPLICATION_JSON_VALUE)))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void maxUploadSizeExceededReturnsImageTooLarge() throws Exception {
        mockMvc.perform(get("/api/test/upload-too-large")
                        .header("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(header().string("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(jsonPath("$.requestId").value(VALID_REQUEST_ID))
                .andExpect(problemDetails(
                        413, "image-too-large", "Image too large",
                        "IMAGE_TOO_LARGE", "/api/test/upload-too-large"))
                .andExpect(jsonPath("$.detail")
                        .value("The uploaded image exceeds the maximum allowed size of 5 MiB."))
                .andExpect(content().string(not(containsString("MaxUploadSizeExceededException"))))
                .andExpect(content().string(not(containsString("Maximum upload size"))));
    }

    @Test
    void methodNotAllowedReturnsProblemDetails() throws Exception {
        mockMvc.perform(patch("/api/posts").with(csrf()))
                .andExpect(problemDetails(
                        405, "method-not-allowed", "Method not allowed",
                        "METHOD_NOT_ALLOWED", "/api/posts"))
                .andExpect(header().string(HttpHeaders.ALLOW, containsString("GET")))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidMediaIdNonNumericReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/test/media/abc"))
                .andExpect(problemDetails(
                        400, "invalid-media-id", "Invalid media ID",
                        "INVALID_MEDIA_ID", "/api/test/media/abc"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void unexpectedExceptionReturnsRedactedProblemDetails() throws Exception {
        mockMvc.perform(get("/api/test/failure"))
                .andExpect(problemDetails(
                        500, "internal-error", "Internal server error",
                        "INTERNAL_ERROR", "/api/test/failure"))
                .andExpect(jsonPath("$.detail").value("An unexpected error occurred."))
                .andExpect(content().string(not(containsString("database-password"))))
                .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

    @Test
    void missingApiRouteReturnsProblemDetails() throws Exception {
        mockMvc.perform(get("/api/nonexistent"))
                .andExpect(problemDetails(
                        404, "resource-not-found", "Resource not found",
                        "RESOURCE_NOT_FOUND", "/api/nonexistent"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void successRequestEchoesValidRequestId() throws Exception {
        mockMvc.perform(get("/api/posts")
                        .header("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Request-ID", VALID_REQUEST_ID));
    }

    @Test
    void errorResponseEchoesRequestIdInHeaderAndBody() throws Exception {
        mockMvc.perform(get("/api/test/failure")
                        .header("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(header().string("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(jsonPath("$.requestId").value(VALID_REQUEST_ID))
                .andExpect(problemDetails(
                        500, "internal-error", "Internal server error",
                        "INTERNAL_ERROR", "/api/test/failure"))
                .andExpect(jsonPath("$.detail").value("An unexpected error occurred."))
                .andExpect(content().string(not(containsString("database-password"))))
                .andExpect(content().string(not(containsString("IllegalStateException"))));
    }

    @Test
    void missingRequestIdReturnsUuidInHeaderAndBody() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/posts").param("channel", "news"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andReturn();

        String headerId = result.getResponse().getHeader("X-Request-ID");
        assertThat("X-Request-ID must be present and a UUID", headerId, matchesPattern(UUID_REGEX));

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertEquals(headerId, body.path("requestId").asText(),
                "body requestId must match X-Request-ID header");
    }

    @ParameterizedTest
    @ValueSource(strings = {"   ", "abc\ndef"})
    void unsafeRequestIdIsReplaced(String unsafeId) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/posts")
                        .param("channel", "news")
                        .header("X-Request-ID", unsafeId))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andReturn();

        String headerId = result.getResponse().getHeader("X-Request-ID");
        assertThat("unsafe ID must be replaced with UUID", headerId, matchesPattern(UUID_REGEX));
        assertThat("unsafe ID must not be echoed back", headerId, not(unsafeId));

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertEquals(headerId, body.path("requestId").asText(),
                "body requestId must match replacement UUID in header");
    }

    @Test
    void unsafeRequestIdTooLongIsReplaced() throws Exception {
        String longId = "a".repeat(65);
        MvcResult result = mockMvc.perform(get("/api/posts")
                        .param("channel", "news")
                        .header("X-Request-ID", longId))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andReturn();

        String headerId = result.getResponse().getHeader("X-Request-ID");
        assertThat("65-char ID must be replaced with UUID", headerId, matchesPattern(UUID_REGEX));

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertEquals(headerId, body.path("requestId").asText(),
                "body requestId must match replacement UUID in header");
    }

    @Test
    void requestIdContextMatchesAndMdcCleared() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/test/context")
                        .header("X-Request-ID", VALID_REQUEST_ID))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertEquals(VALID_REQUEST_ID, body.path("requestId").asText(),
                "request attribute during execution must match accepted ID");
        assertEquals(VALID_REQUEST_ID, body.path("mdcRequestId").asText(),
                "MDC requestId during execution must match accepted ID");

        assertNull(MDC.get("requestId"), "MDC must be cleared after request");
    }

    private static ResultMatcher problemDetails(
            int expectedStatus,
            String typeSuffix,
            String title,
            String code,
            String instance) {
        return result -> {
            status().is(expectedStatus).match(result);
            content().contentType(PROBLEM_JSON).match(result);
            jsonPath("$.type")
                    .value("urn:phark:problem:" + typeSuffix)
                    .match(result);
            jsonPath("$.title").value(title).match(result);
            jsonPath("$.status").value(expectedStatus).match(result);
            jsonPath("$.instance").value(instance).match(result);
            jsonPath("$.code").value(code).match(result);
        };
    }

    @RestController
    static class FailingController {

        @GetMapping("/api/test/failure")
        void fail() {
            throw new IllegalStateException("database-password must stay server-side");
        }

        @GetMapping("/api/test/context")
        Map<String, String> context(HttpServletRequest request) {
            String attr = (String) request.getAttribute("requestId");
            String mdc = MDC.get("requestId");
            return Map.of(
                    "requestId", attr != null ? attr : "",
                    "mdcRequestId", mdc != null ? mdc : ""
            );
        }

        @GetMapping("/api/test/media/{mediaId}")
        void media(@PathVariable long mediaId) {
        }

        @GetMapping("/api/test/upload-too-large")
        void uploadTooLarge() {
            throw new MaxUploadSizeExceededException(5L * 1024 * 1024);
        }
    }
}
