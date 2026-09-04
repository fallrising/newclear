package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.Account;
import com.example.deck.model.AccountProfile;
import com.example.deck.repository.AccountRepository;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AccountService {

    private static final Pattern HANDLE_PATTERN = Pattern.compile("[a-z0-9_]{3,15}");
    private static final int MAX_DISPLAY_NAME_LENGTH = 50;
    private static final int MAX_BIO_LENGTH = 160;
    private static final int MIN_PASSWORD_BYTES = 12;
    private static final int MAX_PASSWORD_BYTES = 72;

    private final AccountRepository accountRepository;
    private final PasswordEncoder passwordEncoder;

    public AccountService(AccountRepository accountRepository, PasswordEncoder passwordEncoder) {
        this.accountRepository = accountRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public AccountProfile register(String handle, String displayName, String password) {
        String canonicalHandle = canonicalizeHandle(handle);
        String normalizedDisplayName = normalizeDisplayName(displayName);
        validatePassword(password);

        if (accountRepository.findByHandle(canonicalHandle).isPresent()) {
            throw new ApiException(ApiErrorCode.HANDLE_UNAVAILABLE);
        }

        try {
            Account account = accountRepository.insert(
                    canonicalHandle,
                    normalizedDisplayName,
                    passwordEncoder.encode(password));
            return toProfile(account);
        } catch (DataAccessException exception) {
            if (accountRepository.findByHandle(canonicalHandle).isPresent()) {
                throw new ApiException(ApiErrorCode.HANDLE_UNAVAILABLE, exception);
            }
            throw exception;
        }
    }

    public AccountProfile updateProfile(long accountId, String displayName, String bio) {
        String normalizedDisplayName = normalizeDisplayName(displayName);
        String normalizedBio = normalizeBio(bio);
        return toProfile(accountRepository.updateProfile(
                accountId, normalizedDisplayName, normalizedBio));
    }

    public Optional<AccountProfile> findProfileById(long accountId) {
        return accountRepository.findById(accountId).map(this::toProfile);
    }

    public AccountProfile getProfileByHandle(String handle) {
        return toProfile(requireAccountByHandle(handle));
    }

    public long getAccountIdByHandle(String handle) {
        return requireAccountByHandle(handle).id();
    }

    public String canonicalizeHandle(String handle) {
        if (handle == null) {
            throw validationFailed();
        }
        String canonical = handle.strip().toLowerCase(Locale.ROOT);
        if (!HANDLE_PATTERN.matcher(canonical).matches()) {
            throw validationFailed();
        }
        return canonical;
    }

    private String normalizeDisplayName(String displayName) {
        if (displayName == null) {
            throw validationFailed();
        }
        String normalized = displayName.strip();
        if (normalized.isEmpty() || normalized.length() > MAX_DISPLAY_NAME_LENGTH) {
            throw validationFailed();
        }
        return normalized;
    }

    private String normalizeBio(String bio) {
        if (bio == null) {
            throw validationFailed();
        }
        String normalized = bio.strip();
        if (normalized.length() > MAX_BIO_LENGTH) {
            throw validationFailed();
        }
        return normalized;
    }

    private void validatePassword(String password) {
        if (password == null) {
            throw validationFailed();
        }
        int byteLength = password.getBytes(StandardCharsets.UTF_8).length;
        if (byteLength < MIN_PASSWORD_BYTES || byteLength > MAX_PASSWORD_BYTES) {
            throw validationFailed();
        }
    }

    private AccountProfile toProfile(Account account) {
        return new AccountProfile(
                account.handle(),
                account.displayName(),
                account.bio(),
                account.createdAt());
    }

    private Account requireAccountByHandle(String handle) {
        String canonicalHandle;
        try {
            canonicalHandle = canonicalizeHandle(handle);
        } catch (ApiException exception) {
            throw new ApiException(ApiErrorCode.PROFILE_NOT_FOUND, exception);
        }
        return accountRepository.findByHandle(canonicalHandle)
                .orElseThrow(() -> new ApiException(ApiErrorCode.PROFILE_NOT_FOUND));
    }

    private ApiException validationFailed() {
        return new ApiException(ApiErrorCode.VALIDATION_FAILED);
    }
}
