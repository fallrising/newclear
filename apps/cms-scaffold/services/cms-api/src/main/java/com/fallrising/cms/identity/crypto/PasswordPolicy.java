package com.fallrising.cms.identity.crypto;

import com.fallrising.cms.identity.IdentityException;

public final class PasswordPolicy {
    private PasswordPolicy() {}
    public static void validate(CharSequence username, CharSequence password) {
        if (password == null || password.length() < 12)
            throw IdentityException.validation("Password must be at least 12 characters");
        if (username == null || username.length() != password.length()) return;
        for (int offset = 0; offset < password.length();) {
            int a = Character.codePointAt(username, offset), b = Character.codePointAt(password, offset);
            if (a != b && Character.toLowerCase(Character.toUpperCase(a)) != Character.toLowerCase(Character.toUpperCase(b))) return;
            offset += Character.charCount(a);
        }
        throw IdentityException.validation("Password must not equal username");
    }
}
