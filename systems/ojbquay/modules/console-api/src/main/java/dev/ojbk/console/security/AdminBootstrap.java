package dev.ojbk.console.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public final class AdminBootstrap implements ApplicationRunner {
    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final String username;
    private final String password;

    AdminBootstrap(
            JdbcClient jdbc,
            PasswordEncoder passwordEncoder,
            @Value("${ojbquay.bootstrap-admin.username}") String username,
            @Value("${ojbquay.bootstrap-admin.password}") String password) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.username = username;
        this.password = password;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        if (password == null || password.isBlank()) {
            return;
        }
        jdbc.sql("""
                        INSERT INTO app_user (username, password_hash, role)
                        VALUES (:username, :passwordHash, 'ADMIN')
                        ON CONFLICT (username) DO NOTHING
                        """)
                .param("username", username)
                .param("passwordHash", passwordEncoder.encode(password))
                .update();
    }
}
