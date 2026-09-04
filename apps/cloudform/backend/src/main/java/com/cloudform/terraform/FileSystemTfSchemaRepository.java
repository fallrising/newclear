package com.cloudform.terraform;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.stream.Stream;

@Repository
@ConditionalOnProperty(name = "cloudform.tf-schema.source", havingValue = "filesystem")
public class FileSystemTfSchemaRepository implements TfSchemaRepository {

    private final TfSchemaParser parser;
    private final Path directory;

    public FileSystemTfSchemaRepository(
            TfSchemaParser parser,
            @Value("${cloudform.tf-schema.dir}") String directory) {
        this.parser = parser;
        this.directory = Paths.get(directory);
    }

    @Override
    public List<TfSchemaSource> list() {
        if (!Files.isDirectory(directory)) return List.of();
        List<TfSchemaSource> out = new ArrayList<>();
        try (Stream<Path> stream = Files.list(directory)) {
            stream.filter(p -> p.toString().endsWith(".json"))
                    .forEach(p -> {
                        try {
                            out.add(TfSchemaSource.fromFilename(p.getFileName().toString()));
                        } catch (IllegalArgumentException ignored) {
                        }
                    });
        } catch (IOException e) {
            throw new TfSchemaParseException("Failed to list " + directory, e);
        }
        return out;
    }

    @Override
    public Optional<TfRoot> find(String provider, String version) {
        Path file = directory.resolve(provider + "-" + version + ".json");
        if (!Files.isRegularFile(file)) return Optional.empty();
        try (InputStream in = Files.newInputStream(file)) {
            return Optional.of(parser.parse(in));
        } catch (IOException e) {
            throw new TfSchemaParseException("Failed to read " + file, e);
        }
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
}
