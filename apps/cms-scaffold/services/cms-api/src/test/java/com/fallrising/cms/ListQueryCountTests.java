package com.fallrising.cms;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.invocation.Invocation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 §5.4 "SQL per list request, independent of the number of entries": one list request makes the same store calls
 * for 1 item as for 6. ContentStore: findTypeByKey, fieldsOf, queryEntries (JdbcContentStore runs COUNT and page
 * SELECT for queryEntries, so 4 SQL statements). Identity store calls are the same for both page sizes (B-12 cache).
 */
@SpringBootTest
@AutoConfigureMockMvc
class ListQueryCountTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @MockitoSpyBean
    ContentStore contentStore;

    @MockitoSpyBean
    IdentityStore identityStore;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B02_workListStoreCallsDoNotGrowWithItems() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = createAlbums(op, 6, false);
        Calls one = calls(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("size", "1")), 1);
        Calls six = calls(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("size", "6")), 6);
        assertThat(one.content()).containsExactly("findTypeByKey", "fieldsOf", "queryEntries");
        assertThat(six.content()).isEqualTo(one.content());
        assertThat(six.identity()).isEqualTo(one.identity());
    }

    @Test
    void B02_publicListStoreCallsDoNotGrowWithItems() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = createAlbums(op, 6, true);
        Calls one = calls(get("/api/v1/public/content-types/album/entries").param("q", token).param("size", "1"), 1);
        Calls six = calls(get("/api/v1/public/content-types/album/entries").param("q", token).param("size", "6"), 6);
        assertThat(one.content()).containsExactly("findTypeByKey", "fieldsOf", "queryEntries");
        assertThat(six.content()).isEqualTo(one.content());
        assertThat(six.identity()).isEqualTo(one.identity());
    }

    /** Creates count albums titled token + i (published with visibility public when publish is true); returns token. */
    private String createAlbums(TestSession op, int count, boolean publish) throws Exception {
        String token = "c" + UUID.randomUUID().toString().substring(0, 8);
        for (int i = 0; i < count; i++) {
            String json = mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries").contentType(MediaType.APPLICATION_JSON)
                            .content(mapper.writeValueAsString(Map.of("slug", token + i,
                                    "payload", Map.of("title", token + i, "visibility", "public"))))))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            if (publish) {
                mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", mapper.readTree(json).get("id").asText())))
                        .andExpect(status().isOk());
            }
        }
        return token;
    }

    record Calls(List<String> content, List<String> identity) {}

    private Calls calls(MockHttpServletRequestBuilder request, int expectedItems) throws Exception {
        Mockito.clearInvocations(contentStore, identityStore);
        mockMvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(expectedItems));
        return new Calls(names(contentStore), names(identityStore));
    }

    private static List<String> names(Object spy) {
        return Mockito.mockingDetails(spy).getInvocations().stream().map(Invocation::getMethod).map(m -> m.getName()).toList();
    }
}
