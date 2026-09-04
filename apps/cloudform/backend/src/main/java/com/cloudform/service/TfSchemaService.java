package com.cloudform.service;

import com.cloudform.dto.schema.ResourceSchemaSummary;
import com.cloudform.dto.schema.SchemaSourceItem;
import com.cloudform.dto.schema.SchemaTreeResponse;
import com.cloudform.terraform.FieldTreeBuilder;
import com.cloudform.terraform.TfProviderSchema;
import com.cloudform.terraform.TfResourceSchema;
import com.cloudform.terraform.TfRoot;
import com.cloudform.terraform.TfSchemaRepository;
import com.cloudform.web.ResourceNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

@Service
public class TfSchemaService {

    private final TfSchemaRepository repository;
    private final FieldTreeBuilder fieldTreeBuilder;

    public TfSchemaService(TfSchemaRepository repository, FieldTreeBuilder fieldTreeBuilder) {
        this.repository = repository;
        this.fieldTreeBuilder = fieldTreeBuilder;
    }

    public List<SchemaSourceItem> listSources() {
        return repository.list().stream()
                .map(src -> {
                    int count = repository.find(src.provider(), src.version())
                            .map(this::countResources)
                            .orElse(0);
                    return new SchemaSourceItem(src.provider(), src.version(), count);
                })
                .toList();
    }

    public List<ResourceSchemaSummary> listResources(String provider, String version) {
        TfRoot root = repository.find(provider, version)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Schema not found: " + provider + " " + version));
        List<ResourceSchemaSummary> out = new java.util.ArrayList<>();
        for (TfProviderSchema p : root.providerSchemas().values()) {
            for (Map.Entry<String, TfResourceSchema> e : new TreeMap<>(p.resourceSchemas()).entrySet()) {
                TfResourceSchema res = e.getValue();
                out.add(new ResourceSchemaSummary(
                        e.getKey(),
                        res.block().attributes().size(),
                        res.block().blockTypes().size(),
                        res.block().description()
                ));
            }
        }
        return out;
    }

    public SchemaTreeResponse getResourceTree(String provider, String version, String resourceName) {
        TfResourceSchema res = repository.findResource(provider, version, resourceName)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Resource not found: " + provider + " " + version + " / " + resourceName));
        return new SchemaTreeResponse(
                provider,
                version,
                resourceName,
                res.block().description(),
                fieldTreeBuilder.build(res)
        );
    }

    private int countResources(TfRoot root) {
        return root.providerSchemas().values().stream()
                .mapToInt(p -> p.resourceSchemas().size())
                .sum();
    }
}
