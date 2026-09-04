package com.cloudform.terraform;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;

@Repository
@ConditionalOnProperty(name = "cloudform.tf-schema.source", havingValue = "classpath", matchIfMissing = true)
public class ClasspathTfSchemaRepository implements TfSchemaRepository {

    private static final String LOCATION_PATTERN = "classpath:tf-schemas/*.json";

    private final TfSchemaParser parser;
    private final PathMatchingResourcePatternResolver resolver = new PathMatchingResourcePatternResolver();

    public ClasspathTfSchemaRepository(TfSchemaParser parser) {
        this.parser = parser;
    }

    @Override
    public List<TfSchemaSource> list() {
        List<TfSchemaSource> out = new ArrayList<>();
        for (Resource r : resources()) {
            String filename = r.getFilename();
            if (filename == null) continue;
            try {
                out.add(TfSchemaSource.fromFilename(filename));
            } catch (IllegalArgumentException ignored) {
                // skip non-conforming files
            }
        }
        return out;
    }

    @Override
    public Optional<TfRoot> find(String provider, String version) {
        String wanted = provider + "-" + version + ".json";
        for (Resource r : resources()) {
            if (wanted.equals(r.getFilename())) {
                try (InputStream in = r.getInputStream()) {
                    return Optional.of(parser.parse(in));
                } catch (IOException e) {
                    throw new TfSchemaParseException("Failed to read " + wanted, e);
                }
            }
        }
        return Optional.empty();
    }

    @Override
    public Optional<TfResourceSchema> findResource(String provider, String version, String resourceName) {
        return find(provider, version).map(root -> {
            try {
                return parser.findResource(root, resourceName);
            } catch (NoSuchElementException e) {
                return null;
            }
        });
    }

    private Resource[] resources() {
        try {
            return resolver.getResources(LOCATION_PATTERN);
        } catch (IOException e) {
            throw new TfSchemaParseException("Failed to scan " + LOCATION_PATTERN, e);
        }
    }
}
