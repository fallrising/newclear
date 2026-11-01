package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PredicateIndexCheckTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final ObjectMapper MAPPER = new ObjectMapper();
    static final String OWN = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";

    /** Compilable pairs: pet.ownerPrincipalId only. */
    static final ContentTypeDirectory DIRECTORY = new ContentTypeDirectory() {
        @Override
        public List<String> enabledTypeKeys() {
            return List.of("pet");
        }

        @Override
        public boolean predicateFieldCompilable(String typeKey, String fieldKey) {
            return Set.of("pet/ownerPrincipalId").contains(typeKey + "/" + fieldKey);
        }
    };

    @Test
    void B10_problemNamesTheReason() {
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", null)).isNull();
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", OWN)).isNull();
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, null, OWN)).isEqualTo("a predicate requires contentType");
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "visit", OWN))
                .isEqualTo("predicate field ownerPrincipalId is not an indexed string, enum or ref field of visit");
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", "{\"type\":\"anyOf\"}"))
                .isEqualTo("unsupported or malformed predicate");
    }

    @Test
    void B10_startupCheckFailsOnAStoredPredicateThatCannotBePushedDown() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        Role member = new Role(UUID.randomUUID(), "member", "Member", true, T0);
        store.insertRole(member);
        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", "pet", OWN, List.of("front"), T0));
        PredicateIndexCheck check = new PredicateIndexCheck(store, DIRECTORY, MAPPER);
        assertThatNoException().isThrownBy(check::check);

        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", "visit", OWN, List.of("front"), T0));
        assertThatThrownBy(check::check)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("member/read_published: predicate field ownerPrincipalId is not an indexed string, enum or ref field of visit");
    }
}
