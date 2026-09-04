package com.cloudform.terraform;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

class ClasspathTfSchemaRepositoryTest {

    private ClasspathTfSchemaRepository repository;

    @BeforeEach
    void setUp() {
        repository = new ClasspathTfSchemaRepository(new TfSchemaParser());
    }

    @Test
    void listsAllSchemas() {
        List<TfSchemaSource> sources = repository.list();
        assertThat(sources)
                .extracting(TfSchemaSource::provider, TfSchemaSource::version)
                .contains(
                        org.assertj.core.groups.Tuple.tuple("alicloud", "1.230.0"),
                        org.assertj.core.groups.Tuple.tuple("aws", "5.70.0")
                );
    }

    @Test
    void findsExistingSchema() {
        Optional<TfRoot> root = repository.find("alicloud", "1.230.0");
        assertThat(root).isPresent();
        assertThat(root.get().providerSchemas()).isNotEmpty();
    }

    @Test
    void returnsEmptyForUnknownVersion() {
        assertThat(repository.find("alicloud", "9.9.9")).isEmpty();
    }

    @Test
    void findsSpecificResource() {
        Optional<TfResourceSchema> rds = repository.findResource("alicloud", "1.230.0", "alicloud_db_instance");
        assertThat(rds).isPresent();
        assertThat(rds.get().block().attributes()).containsKey("engine");
    }

    @Test
    void filenameParsing() {
        assertThat(TfSchemaSource.fromFilename("alicloud-1.230.0.json"))
                .extracting(TfSchemaSource::provider, TfSchemaSource::version)
                .containsExactly("alicloud", "1.230.0");
        assertThat(TfSchemaSource.fromFilename("aws-5.70.0.json"))
                .extracting(TfSchemaSource::provider, TfSchemaSource::version)
                .containsExactly("aws", "5.70.0");
    }
}
