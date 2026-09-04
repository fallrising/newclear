package com.cloudform.terraform;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class FieldTreeBuilderTest {

    private TfSchemaParser parser;
    private FieldTreeBuilder builder;

    @BeforeEach
    void setUp() {
        parser = new TfSchemaParser();
        builder = new FieldTreeBuilder(parser);
    }

    @Test
    void flattensAlicloudRdsAttributesAtRoot() {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        TfResourceSchema rds = parser.findResource(root, "alicloud_db_instance");

        List<TfFieldNode> tree = builder.build(rds);

        // root-level attributes appear as leaf nodes
        assertThat(findByPath(tree, "engine"))
                .isPresent()
                .get()
                .satisfies(n -> {
                    assertThat(n.required()).isTrue();
                    assertThat(n.tfType()).isEqualTo("string");
                    assertThat(n.children()).isEmpty();
                });

        assertThat(findByPath(tree, "security_ips"))
                .get()
                .satisfies(n -> assertThat(n.tfType()).isEqualTo("set(string)"));

        assertThat(findByPath(tree, "tags"))
                .get()
                .satisfies(n -> assertThat(n.tfType()).isEqualTo("map(string)"));
    }

    @Test
    void expandsNestedBlocksWithDottedPaths() {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        TfResourceSchema rds = parser.findResource(root, "alicloud_db_instance");

        List<TfFieldNode> tree = builder.build(rds);

        Optional<TfFieldNode> parameters = findByPath(tree, "parameters");
        assertThat(parameters)
                .isPresent()
                .get()
                .satisfies(n -> {
                    assertThat(n.isNestedBlock()).isTrue();
                    assertThat(n.nestingMode()).isEqualTo("set");
                    assertThat(n.children()).hasSize(2);
                });

        // child paths are dotted
        assertThat(findByPath(parameters.get().children(), "parameters.name"))
                .get()
                .satisfies(n -> assertThat(n.required()).isTrue());
        assertThat(findByPath(parameters.get().children(), "parameters.value")).isPresent();
    }

    @Test
    void awsTimeoutsBlockIsSingleNested() {
        TfRoot root = parser.parse(load("tf-schemas/aws-5.70.0.json"));
        TfResourceSchema rds = parser.findResource(root, "aws_db_instance");

        List<TfFieldNode> tree = builder.build(rds);

        TfFieldNode timeouts = findByPath(tree, "timeouts").orElseThrow();
        assertThat(timeouts.nestingMode()).isEqualTo("single");
        assertThat(timeouts.children())
                .extracting(TfFieldNode::tfPath)
                .containsExactlyInAnyOrder("timeouts.create", "timeouts.delete", "timeouts.update");
    }

    @Test
    void outputIsSortedByKeyForStableDiffs() {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        TfResourceSchema rds = parser.findResource(root, "alicloud_db_instance");

        List<TfFieldNode> tree = builder.build(rds);
        // attributes come first (sorted), then nested blocks (sorted)
        List<String> paths = tree.stream().map(TfFieldNode::tfPath).toList();
        List<String> sortedAttrs = paths.stream().filter(p -> !p.contains(".")).filter(p -> !p.equals("parameters") && !p.equals("pg_hba_conf")).sorted().toList();
        List<String> attrsInOrder = paths.stream().filter(p -> !p.equals("parameters") && !p.equals("pg_hba_conf")).toList();
        assertThat(attrsInOrder).isEqualTo(sortedAttrs);
    }

    private static Optional<TfFieldNode> findByPath(List<TfFieldNode> nodes, String path) {
        return nodes.stream().filter(n -> n.tfPath().equals(path)).findFirst();
    }

    private InputStream load(String classpathLocation) {
        InputStream in = getClass().getClassLoader().getResourceAsStream(classpathLocation);
        if (in == null) throw new IllegalStateException("Missing test resource: " + classpathLocation);
        return in;
    }
}
