package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.service.AuditSearch;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin/audit")
public class AuditController {

    private final AuditSearch audit;

    public AuditController(AuditSearch audit) {
        this.audit = audit;
    }

    @GetMapping
    public Map<String, Object> search(HttpServletRequest request) {
        return audit.search(AuthController.current(request), request.getParameterMap());
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        return audit.get(AuthController.current(request), id);
    }
}
