package compose

import (
	"reflect"
	"strings"
	"testing"

	"github.com/fallrising/newclear/specs/fleet/internal/fleetfile"
	"gopkg.in/yaml.v3"
)

func contractDoc() *fleetfile.Document {
	return &fleetfile.Document{APIVersion: fleetfile.APIVersionV1, Kind: fleetfile.KindService,
		Metadata: fleetfile.Metadata{Name: "hello"}, Spec: fleetfile.Spec{Node: "node-1", Image: "busybox:latest",
			Expose: fleetfile.Expose{Mode: fleetfile.ModePublic, Port: 8080}}}
}

func TestRenderPreservesStringsAndPreventsInjection(t *testing.T) {
	doc := contractDoc()
	doc.Spec.WorkingDir = "/tmp\n    privileged: !!bool true\n    network_mode: 'host'"
	doc.Spec.Command = []string{"true", "hello # world", "", "$HOST", "a\nb", "x: y", "[one]"}
	doc.Spec.Args = []string{"null", "false", "${HOME}", "\\", "it's fine"}
	doc.Spec.Volumes = []fleetfile.Volume{{Name: "data", Mount: "/data:ro"}}
	if err := fleetfile.Validate(doc, fleetfile.TestConfig()); err != nil {
		t.Fatal(err)
	}
	out, _, err := Render(Input{Doc: doc, HostPort: 20001, ReleaseID: "rel_test", Generation: 1})
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err := yaml.Unmarshal([]byte(out), &raw); err != nil {
		t.Fatal(err)
	}
	app := raw["services"].(map[string]any)["app"].(map[string]any)
	if _, ok := app["privileged"]; ok {
		t.Fatal("injected privileged field")
	}
	if _, ok := app["network_mode"]; ok {
		t.Fatal("injected network mode")
	}
	if app["working_dir"] != doc.Spec.WorkingDir {
		t.Fatalf("working dir: %#v", app["working_dir"])
	}
	for key, want := range map[string][]string{"entrypoint": doc.Spec.Command, "command": doc.Spec.Args} {
		var got []string
		for _, item := range app[key].([]any) {
			s, ok := item.(string)
			if !ok {
				t.Fatalf("%s item has type %T", key, item)
			}
			got = append(got, strings.ReplaceAll(s, "$$", "$"))
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: got %#v want %#v", key, got, want)
		}
	}
	vol := app["volumes"].([]any)[0]
	m, ok := vol.(map[string]any)
	if !ok || m["target"] != "/data:ro" {
		t.Fatalf("volume target not preserved: %#v", vol)
	}
}

func TestOutputValidatorChecksSemanticValues(t *testing.T) {
	base := "name: fleet-hello\nservices:\n  app:\n    image: busybox\n    ports: ['127.0.0.1:20001:8080']\n"
	for _, extra := range []string{
		"    privileged: !!bool true\n",
		"    'privileged': true\n",
		"    network_mode: 'host'\n",
		"    network_mode: \"host\"\n",
		"  extra:\n    image: busybox\n    ports: ['0.0.0.0:80:80']\n",
	} {
		t.Run(extra, func(t *testing.T) {
			if err := ValidateOutput(base+extra, "hello"); err == nil {
				t.Fatal("unsafe compose accepted")
			}
		})
	}
	if err := ValidateOutput(base+"    command: ['privileged: true', 'network_mode: host']\n", "hello"); err != nil {
		t.Fatalf("safe argument falsely rejected: %v", err)
	}
}

func TestRenderEnvLiteralValues(t *testing.T) {
	got := RenderEnv(map[string]string{"SAFE": "ok\nEXTRA=bad", "QUOTE": "it's \"fine\" $HOME", "TAIL": "ends\\", "EMPTY": ""})
	want := "EMPTY=''\nQUOTE='it\\'s \"fine\" $HOME'\nSAFE='ok\nEXTRA=bad'\nTAIL=\"ends\\\\\"\n"
	if got != want {
		t.Fatalf("dotenv syntax:\ngot %q\nwant %q", got, want)
	}
}
