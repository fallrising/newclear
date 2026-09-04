package com.cloudform.terraform;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.NoSuchElementException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TfSchemaParserTest {

    private TfSchemaParser parser;

    @BeforeEach
    void setUp() {
        parser = new TfSchemaParser();
    }

    @Test
    void parsesAlicloudSchema() throws Exception {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));

        assertThat(root.formatVersion()).isEqualTo("1.0");
        assertThat(root.providerSchemas()).containsKey("registry.terraform.io/aliyun/alicloud");

        TfProviderSchema provider = root.providerSchemas().get("registry.terraform.io/aliyun/alicloud");
        assertThat(provider.resourceSchemas())
                .containsKeys("alicloud_db_instance", "alicloud_vpc", "alicloud_vswitch");
    }

    @Test
    void findsRdsInstanceWithCorrectAttributeFlags() throws Exception {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        TfResourceSchema rds = parser.findResource(root, "alicloud_db_instance");

        TfAttribute engine = rds.block().attributes().get("engine");
        assertThat(engine).isNotNull();
        assertThat(engine.required()).isTrue();
        assertThat(engine.computed()).isFalse();

        TfAttribute id = rds.block().attributes().get("id");
        assertThat(id.computed()).isTrue();
        assertThat(id.required()).isFalse();
    }

    @Test
    void findResourceThrowsWhenMissing() throws Exception {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        assertThatThrownBy(() -> parser.findResource(root, "alicloud_does_not_exist"))
                .isInstanceOf(NoSuchElementException.class);
    }

    @Test
    void rendersTypeExpressions() throws Exception {
        ObjectMapper m = new ObjectMapper();

        assertThat(parser.renderType(m.readTree("\"string\""))).isEqualTo("string");
        assertThat(parser.renderType(m.readTree("[\"list\", \"string\"]"))).isEqualTo("list(string)");
        assertThat(parser.renderType(m.readTree("[\"set\", \"string\"]"))).isEqualTo("set(string)");
        assertThat(parser.renderType(m.readTree("[\"map\", \"string\"]"))).isEqualTo("map(string)");
        assertThat(parser.renderType(m.readTree("[\"set\", [\"map\", \"string\"]]"))).isEqualTo("set(map(string))");
        JsonNode objectType = m.readTree("[\"object\", {\"name\": \"string\"}]");
        assertThat(parser.renderType(objectType)).isEqualTo("object(...)");
    }

    @Test
    void rendersSetStringFromAlicloudSecurityIps() throws Exception {
        TfRoot root = parser.parse(load("tf-schemas/alicloud-1.230.0.json"));
        TfResourceSchema rds = parser.findResource(root, "alicloud_db_instance");
        TfAttribute ips = rds.block().attributes().get("security_ips");

        assertThat(parser.renderType(ips.type())).isEqualTo("set(string)");
    }

    @Test
    void parsesAwsSchemaWithNestedBlocks() throws Exception {
        TfRoot root = parser.parse(load("tf-schemas/aws-5.70.0.json"));
        TfResourceSchema rds = parser.findResource(root, "aws_db_instance");

        assertThat(rds.block().blockTypes()).containsKeys("restore_to_point_in_time", "timeouts");
        TfNestedBlock restore = rds.block().blockTypes().get("restore_to_point_in_time");
        assertThat(restore.nestingMode()).isEqualTo("list");
        assertThat(restore.maxItems()).isEqualTo(1);

        TfNestedBlock timeouts = rds.block().blockTypes().get("timeouts");
        assertThat(timeouts.nestingMode()).isEqualTo("single");
        assertThat(timeouts.block().attributes()).containsKeys("create", "delete", "update");
    }

    private InputStream load(String classpathLocation) {
        InputStream in = getClass().getClassLoader().getResourceAsStream(classpathLocation);
        if (in == null) throw new IllegalStateException("Missing test resource: " + classpathLocation);
        return in;
    }
}
