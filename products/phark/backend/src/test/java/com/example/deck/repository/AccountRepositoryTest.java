package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.Account;
import com.example.deck.model.AccountProfile;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = {"app.db.path=:memory:"})
@Transactional
class AccountRepositoryTest {

    @Autowired
    private AccountRepository accountRepository;

    @Test
    void insertReturnsCanonicalAccountData() {
        Account account = accountRepository.insert("testuser", "Test User", "secret-hash-123");

        assertThat(account.handle()).isEqualTo("testuser");
        assertThat(account.displayName()).isEqualTo("Test User");
        assertThat(account.bio()).isEmpty();
        assertThat(account.passwordHash()).isEqualTo("secret-hash-123");
        assertThat(account.createdAt()).isNotNull();
        assertThat(account.updatedAt()).isEqualTo(account.createdAt());
    }

    @Test
    void findByIdReturnsAccount() {
        Account inserted = accountRepository.insert("testuser", "Test User", "secret-hash-123");
        Account found = accountRepository.findById(inserted.id()).orElseThrow();
        assertThat(found.id()).isEqualTo(inserted.id());
        assertThat(found.handle()).isEqualTo("testuser");
    }

    @Test
    void findByIdReturnsEmptyWhenNotFound() {
        assertThat(accountRepository.findById(-1L)).isEmpty();
    }

    @Test
    void findByHandleIsCaseInsensitive() {
        accountRepository.insert("testuser", "Test User", "secret-hash-123");
        Account found = accountRepository.findByHandle("TESTUSER").orElseThrow();
        assertThat(found.handle()).isEqualTo("testuser");
    }

    @Test
    void findByHandleReturnsEmptyWhenNotFound() {
        assertThat(accountRepository.findByHandle("nonexistent")).isEmpty();
    }

    @Test
    void updateOnlyModifiesDisplayNameAndBio() {
        Account original = accountRepository.insert("testuser", "Original Name", "secret-hash-123");
        String originalHandle = original.handle();
        String originalPasswordHash = original.passwordHash();
        Instant originalCreatedAt = original.createdAt();

        Account updated =
                accountRepository.updateProfile(original.id(), "New Name", "New bio text");

        assertThat(updated.displayName()).isEqualTo("New Name");
        assertThat(updated.bio()).isEqualTo("New bio text");
        assertThat(updated.handle()).isEqualTo(originalHandle);
        assertThat(updated.passwordHash()).isEqualTo(originalPasswordHash);
        assertThat(updated.createdAt()).isEqualTo(originalCreatedAt);
    }

    @Test
    void duplicateHandleThrowsException() {
        accountRepository.insert("testuser", "First", "hash-1");
        assertThatThrownBy(() -> accountRepository.insert("testuser", "Second", "hash-2"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void nonCanonicalUppercaseHandleFails() {
        assertThatThrownBy(() -> accountRepository.insert("TestUser", "Tester", "hash"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void handleTooShortFails() {
        assertThatThrownBy(() -> accountRepository.insert("ab", "Tester", "hash"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void handleTooLongFails() {
        assertThatThrownBy(() ->
                        accountRepository.insert("abcdefghijklmnop", "Tester", "hash"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void handleWithInvalidCharsFails() {
        assertThatThrownBy(() -> accountRepository.insert("hello world", "Tester", "hash"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void displayNameTooLongFails() {
        assertThatThrownBy(() -> accountRepository.insert("tester", "a".repeat(51), "hash"))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void bioTooLongFails() {
        assertThatThrownBy(() ->
                        accountRepository.insert("tester", "Tester", "hash", "a".repeat(161)))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void emptyPasswordHashFails() {
        assertThatThrownBy(() -> accountRepository.insert("tester", "Tester", ""))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void accountProfileDoesNotContainPasswordHash() {
        assertThat(AccountProfile.class.getRecordComponents())
                .extracting(RecordComponent::getName)
                .containsExactly("handle", "displayName", "bio", "createdAt");
    }
}
