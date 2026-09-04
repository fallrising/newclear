package com.cloudform.terraform;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Walks a TfBlock recursively and produces a tree of TfFieldNode.
 *
 * - Attributes become leaf nodes with dotted tfPath (e.g. "vpc_config.subnet_ids").
 * - Nested blocks become branch nodes; their children carry the inner attributes.
 * - Output is sorted by key within each block for stable ordering.
 */
@Component
public class FieldTreeBuilder {

    private final TfSchemaParser parser;

    public FieldTreeBuilder(TfSchemaParser parser) {
        this.parser = parser;
    }

    public List<TfFieldNode> build(TfResourceSchema schema) {
        if (schema == null || schema.block() == null) return List.of();
        return walk(schema.block(), "");
    }

    private List<TfFieldNode> walk(TfBlock block, String prefix) {
        List<TfFieldNode> out = new ArrayList<>();

        for (Map.Entry<String, TfAttribute> e : new TreeMap<>(block.attributes()).entrySet()) {
            String key = e.getKey();
            TfAttribute attr = e.getValue();
            out.add(new TfFieldNode(
                    join(prefix, key),
                    parser.renderType(attr.type()),
                    attr.required(),
                    attr.optional(),
                    attr.computed(),
                    attr.sensitive(),
                    attr.description(),
                    null,
                    List.of()
            ));
        }

        for (Map.Entry<String, TfNestedBlock> e : new TreeMap<>(block.blockTypes()).entrySet()) {
            String key = e.getKey();
            TfNestedBlock nested = e.getValue();
            String childPrefix = join(prefix, key);
            List<TfFieldNode> children = nested.block() == null ? List.of() : walk(nested.block(), childPrefix);
            out.add(new TfFieldNode(
                    childPrefix,
                    nested.nestingMode() == null ? "block" : nested.nestingMode() + "(block)",
                    false,
                    true,
                    false,
                    false,
                    nested.block() == null ? null : nested.block().description(),
                    nested.nestingMode(),
                    children
            ));
        }

        return out;
    }

    private static String join(String prefix, String key) {
        return prefix.isEmpty() ? key : prefix + "." + key;
    }
}
