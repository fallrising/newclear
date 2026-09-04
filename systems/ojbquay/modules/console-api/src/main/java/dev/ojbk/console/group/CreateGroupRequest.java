package dev.ojbk.console.group;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateGroupRequest(
        @NotBlank @Size(max = 128) String name, @Size(max = 500) String remark) {}
