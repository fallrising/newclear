package com.cloudform.terraform;

/**
 * Identifies one TF schema artifact: a (provider, version) pair derived from
 * the filename convention {provider}-{version}.json.
 */
public record TfSchemaSource(String provider, String version, String filename) {

    public static TfSchemaSource fromFilename(String filename) {
        String name = filename.endsWith(".json") ? filename.substring(0, filename.length() - 5) : filename;
        int dash = name.indexOf('-');
        if (dash <= 0 || dash == name.length() - 1) {
            throw new IllegalArgumentException(
                    "Schema file must be named {provider}-{version}.json, got: " + filename);
        }
        return new TfSchemaSource(name.substring(0, dash), name.substring(dash + 1), filename);
    }
}
