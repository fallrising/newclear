package com.cloudform.generation.dto;

import java.util.List;

public record FormsDto(
        FormDefinitionDto userForm,
        FormDefinitionDto opsForm,
        List<FixedFieldDto> fixedFields
) {}
