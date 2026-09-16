package schemas_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	jsonschema "github.com/santhosh-tekuri/jsonschema/v6"
)

const schemaURL = "https://mkfk.invalid/schemas/v1.json"

const clusterSchemaURL = "https://mkfk.invalid/schemas/cluster-v1.json"

type endpoint struct {
	Request  string `json:"request"`
	Response string `json:"response"`
}

func TestEveryEndpointReferencesCompilableSchemas(t *testing.T) {
	t.Parallel()
	compiler := newCompiler(t)
	catalogBytes, err := os.ReadFile("endpoints-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var catalog map[string]endpoint
	if err := json.Unmarshal(catalogBytes, &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog) != 10 {
		t.Fatalf("endpoint catalog has %d entries, want 10", len(catalog))
	}
	for path, contract := range catalog {
		path, contract := path, contract
		t.Run(path, func(t *testing.T) {
			for _, definition := range []string{contract.Request, contract.Response} {
				if definition == "" {
					continue
				}
				if _, err := compiler.Compile(schemaURL + "#/$defs/" + definition); err != nil {
					t.Fatalf("compile %s: %v", definition, err)
				}
			}
		})
	}
	if _, err := compiler.Compile(schemaURL + "#/$defs/errorEnvelope"); err != nil {
		t.Fatalf("compile error envelope: %v", err)
	}
}

func TestExamplesAndCounterexamples(t *testing.T) {
	t.Parallel()
	compiler := newCompiler(t)
	for _, test := range []struct {
		name       string
		definition string
		file       string
		valid      bool
	}{
		{name: "produce valid", definition: "produceRequest", file: "produce.valid.json", valid: true},
		{name: "produce invalid", definition: "produceRequest", file: "produce.invalid.json", valid: false},
		{name: "error valid", definition: "errorEnvelope", file: "error.valid.json", valid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			schema, err := compiler.Compile(schemaURL + "#/$defs/" + test.definition)
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join("..", "examples", test.file))
			if err != nil {
				t.Fatal(err)
			}
			var document any
			decoder := json.NewDecoder(bytes.NewReader(data))
			decoder.UseNumber()
			if err := decoder.Decode(&document); err != nil {
				t.Fatal(err)
			}
			err = schema.Validate(document)
			if (err == nil) != test.valid {
				t.Fatalf("validation error = %v, want valid %v", err, test.valid)
			}
		})
	}
}

func TestDevelopmentClusterMatchesSchema(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile(filepath.Join("..", "..", "configs", "dev-cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	schemaData, err := os.ReadFile("cluster-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var schemaDocument any
	if err := json.Unmarshal(schemaData, &schemaDocument); err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(clusterSchemaURL, schemaDocument); err != nil {
		t.Fatal(err)
	}
	schema, err := compiler.Compile(clusterSchemaURL + "#/$defs/clusterManifest")
	if err != nil {
		t.Fatal(err)
	}
	if err := schema.Validate(document); err != nil {
		t.Fatal(err)
	}
}

func newCompiler(t *testing.T) *jsonschema.Compiler {
	t.Helper()
	data, err := os.ReadFile("v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(schemaURL, document); err != nil {
		t.Fatal(fmt.Errorf("add schema resource: %w", err))
	}
	return compiler
}
