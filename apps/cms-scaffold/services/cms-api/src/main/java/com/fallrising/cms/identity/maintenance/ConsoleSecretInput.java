package com.fallrising.cms.identity.maintenance;

import java.util.function.Function;
import java.util.Arrays;
import java.nio.CharBuffer;
import com.fallrising.cms.identity.crypto.PasswordPolicy;

public final class ConsoleSecretInput {
    private final Function<String, char[]> reader;

    public ConsoleSecretInput() {
        this(prompt -> {
            var console = System.console();
            if (console == null) throw new IdentityMaintenanceCommand.Failure(
                    IdentityMaintenanceCommand.FailureCode.SECRET_INPUT_INVALID);
            return console.readPassword("%s", prompt);
        });
    }

    ConsoleSecretInput(Function<String, char[]> reader) { this.reader = reader; }

    public char[] readAndConfirm(String username) {
        char[] first = null, second = null;
        boolean returned = false;
        try {
            first = reader.apply("New password: ");
            if (first == null) throw new IllegalStateException();
            second = reader.apply("Confirm password: ");
            if (second == null || !Arrays.equals(first, second)) throw new IllegalStateException();
            PasswordPolicy.validate(username, CharBuffer.wrap(first));
            returned = true;
            return first;
        } catch (RuntimeException ignored) {
            throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.SECRET_INPUT_INVALID);
        } finally {
            if (second != null) Arrays.fill(second, '\0');
            if (!returned && first != null) Arrays.fill(first, '\0');
        }
    }
}
