package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Account;
import com.example.deck.model.AccountProfile;
import com.example.deck.repository.AccountRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class AccountServiceTest {

    private static final String VALID_PASSWORD = "correct horse battery staple";

    @Autowired
    private AccountService accountService;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Test
    void registerCanonicalizesProfileAndHashesPassword() {
        AccountProfile profile =
                accountService.register("  Alice_OPS  ", "  Alice Operator  ", VALID_PASSWORD);

        assertThat(profile.handle()).isEqualTo("alice_ops");
        assertThat(profile.displayName()).isEqualTo("Alice Operator");
        assertThat(profile.bio()).isEmpty();

        Account account = accountRepository.findByHandle("alice_ops").orElseThrow();
        assertThat(account.passwordHash())
                .startsWith("{bcrypt}")
                .doesNotContain(VALID_PASSWORD);
        assertThat(passwordEncoder.matches(VALID_PASSWORD, account.passwordHash())).isTrue();
    }

    @Test
    void duplicateCanonicalHandleUsesStableConflictCode() {
        accountService.register("alice", "Alice", VALID_PASSWORD);

        assertApiError(
                () -> accountService.register(" ALICE ", "Another Alice", VALID_PASSWORD),
                ApiErrorCode.HANDLE_UNAVAILABLE);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ab", "abcdefghijklmnop", "alice-ops", "alice ops", "ålice"})
    void invalidHandleDoesNotCreateAccount(String handle) {
        assertApiError(
                () -> accountService.register(handle, "Alice", VALID_PASSWORD),
                ApiErrorCode.VALIDATION_FAILED);
        assertThat(accountRepository.findByHandle(handle)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   "})
    void blankDisplayNameDoesNotCreateAccount(String displayName) {
        assertApiError(
                () -> accountService.register("alice", displayName, VALID_PASSWORD),
                ApiErrorCode.VALIDATION_FAILED);
        assertThat(accountRepository.findByHandle("alice")).isEmpty();
    }

    @Test
    void overlongDisplayNameDoesNotCreateAccount() {
        assertApiError(
                () -> accountService.register("alice", "a".repeat(51), VALID_PASSWORD),
                ApiErrorCode.VALIDATION_FAILED);
        assertThat(accountRepository.findByHandle("alice")).isEmpty();
    }

    @Test
    void passwordBelowMinimumDoesNotCreateAccount() {
        assertApiError(
                () -> accountService.register("alice", "Alice", "a".repeat(11)),
                ApiErrorCode.VALIDATION_FAILED);
        assertThat(accountRepository.findByHandle("alice")).isEmpty();
    }

    @Test
    void passwordAboveBcryptByteLimitDoesNotCreateAccount() {
        assertApiError(
                () -> accountService.register("alice", "Alice", "🙂".repeat(19)),
                ApiErrorCode.VALIDATION_FAILED);
        assertThat(accountRepository.findByHandle("alice")).isEmpty();
    }

    @Test
    void updateProfileTrimsValuesAndPreservesIdentity() {
        accountService.register("alice", "Alice", VALID_PASSWORD);
        Account before = accountRepository.findByHandle("alice").orElseThrow();

        AccountProfile updated =
                accountService.updateProfile(before.id(), "  Alice Updated  ", "  Hello world  ");

        assertThat(updated.handle()).isEqualTo("alice");
        assertThat(updated.displayName()).isEqualTo("Alice Updated");
        assertThat(updated.bio()).isEqualTo("Hello world");
        Account after = accountRepository.findById(before.id()).orElseThrow();
        assertThat(after.passwordHash()).isEqualTo(before.passwordHash());
        assertThat(after.createdAt()).isEqualTo(before.createdAt());
    }

    @Test
    void invalidProfileUpdateLeavesStoredValuesUnchanged() {
        accountService.register("alice", "Alice", VALID_PASSWORD);
        Account before = accountRepository.findByHandle("alice").orElseThrow();

        assertApiError(
                () -> accountService.updateProfile(before.id(), "Alice", "a".repeat(161)),
                ApiErrorCode.VALIDATION_FAILED);

        Account after = accountRepository.findById(before.id()).orElseThrow();
        assertThat(after.displayName()).isEqualTo("Alice");
        assertThat(after.bio()).isEmpty();
    }

    private void assertApiError(Runnable action, ApiErrorCode expectedCode) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception -> assertThat(exception.getCode()).isEqualTo(expectedCode));
    }
}
