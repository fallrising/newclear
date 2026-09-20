package com.fallrising.cms.identity.domain;

import java.util.List;
import java.util.UUID;

public record PrincipalRoleAssignment(UUID principalId, UUID roleId, String roleCode, List<String> contentTypeCodes) {}
