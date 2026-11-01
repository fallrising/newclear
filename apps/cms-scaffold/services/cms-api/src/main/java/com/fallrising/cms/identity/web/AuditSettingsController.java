package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.service.AuditRetentionService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/settings/audit")
public class AuditSettingsController {

    private final AuditRetentionService retention;

    public AuditSettingsController(AuditRetentionService retention) {
        this.retention = retention;
    }

    @GetMapping
    public Map<String, Object> get(HttpServletRequest request) {
        return retention.get(AuthController.current(request));
    }

    @PatchMapping
    public Map<String, Object> patch(@RequestBody Map<String, Object> body, HttpServletRequest request) {
        return retention.update(AuthController.current(request), body);
    }
}
