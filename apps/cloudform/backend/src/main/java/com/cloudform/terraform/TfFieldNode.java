package com.cloudform.terraform;

import java.util.List;

/**
 * Flattened view of one field in a TF resource schema, used by the designer.
 * Nested blocks become parent nodes whose children hold their inner attributes.
 */
public record TfFieldNode(
        String tfPath,
        String tfType,
        boolean required,
        boolean optional,
        boolean computed,
        boolean sensitive,
        String description,
        String nestingMode,
        List<TfFieldNode> children
) {
    public TfFieldNode {
        children = children == null ? List.of() : List.copyOf(children);
    }

    public boolean isNestedBlock() {
        return nestingMode != null;
    }
}
