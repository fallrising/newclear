package com.cloudform.dto.field;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

public record BatchFieldUpdateRequest(
        @NotEmpty @Valid List<FieldConfigUpdateRequest> fields
) {
}
