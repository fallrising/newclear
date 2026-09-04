package com.cloudform.terraform;

import java.util.List;
import java.util.Optional;

/**
 * Reads pre-generated TF provider schema JSON files. Implementations decide
 * where the files live (classpath / filesystem / object storage).
 */
public interface TfSchemaRepository {

    List<TfSchemaSource> list();

    Optional<TfRoot> find(String provider, String version);

    Optional<TfResourceSchema> findResource(String provider, String version, String resourceName);
}
