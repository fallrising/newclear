package compose

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"gopkg.in/yaml.v3"
)

type Input struct {
	Doc        *fleetfile.Document
	Image      string
	HostPort   int
	ReleaseID  string
	Generation int64
}

func Render(in Input) (yamlOut string, envFile string, err error) {
	if in.Doc == nil {
		return "", "", fmt.Errorf("nil document")
	}
	name := in.Doc.Metadata.Name
	image := in.Image
	if image == "" {
		image = in.Doc.Spec.Image
	}
	var b strings.Builder
	fmt.Fprintf(&b, "name: fleet-%s\n", name)
	b.WriteString("services:\n")
	b.WriteString("  app:\n")
	fmt.Fprintf(&b, "    image: %s\n", image)
	fmt.Fprintf(&b, "    container_name: fleet-%s-app\n", name)
	b.WriteString("    restart: unless-stopped\n")
	if in.Doc.Spec.User != "" {
		fmt.Fprintf(&b, "    user: %q\n", in.Doc.Spec.User)
	}
	if in.Doc.Spec.WorkingDir != "" {
		fmt.Fprintf(&b, "    working_dir: %s\n", in.Doc.Spec.WorkingDir)
	}
	writeList(&b, "    entrypoint", in.Doc.Spec.Command)
	writeList(&b, "    command", in.Doc.Spec.Args)
	b.WriteString("    env_file:\n")
	b.WriteString("      - .env\n")
	b.WriteString("    ports:\n")
	fmt.Fprintf(&b, "      - %q\n", fmt.Sprintf("127.0.0.1:%d:%d", in.HostPort, in.Doc.Spec.Expose.Port))
	if len(in.Doc.Spec.Volumes) > 0 {
		b.WriteString("    volumes:\n")
		for _, v := range in.Doc.Spec.Volumes {
			fmt.Fprintf(&b, "      - fleet-%s_%s:%s\n", name, v.Name, v.Mount)
		}
	}
	if in.Doc.Spec.Resources != nil {
		if in.Doc.Spec.Resources.Memory != "" {
			fmt.Fprintf(&b, "    mem_limit: %s\n", in.Doc.Spec.Resources.Memory)
		}
		if in.Doc.Spec.Resources.CPUs != "" {
			fmt.Fprintf(&b, "    cpus: %q\n", in.Doc.Spec.Resources.CPUs)
		}
		b.WriteString("    deploy:\n")
		b.WriteString("      resources:\n")
		b.WriteString("        limits:\n")
		if in.Doc.Spec.Resources.Memory != "" {
			fmt.Fprintf(&b, "          memory: %s\n", in.Doc.Spec.Resources.Memory)
		}
		if in.Doc.Spec.Resources.CPUs != "" {
			fmt.Fprintf(&b, "          cpus: %q\n", in.Doc.Spec.Resources.CPUs)
		}
	}
	b.WriteString("    labels:\n")
	fmt.Fprintf(&b, "      fleet.catalog/service: %s\n", name)
	fmt.Fprintf(&b, "      fleet.catalog/release: %s\n", in.ReleaseID)
	fmt.Fprintf(&b, "      fleet.catalog/generation: %q\n", strconv.FormatInt(in.Generation, 10))
	b.WriteString("    logging:\n")
	b.WriteString("      driver: json-file\n")
	b.WriteString("      options:\n")
	b.WriteString("        max-size: \"10m\"\n")
	b.WriteString("        max-file: \"3\"\n")
	if len(in.Doc.Spec.Volumes) > 0 {
		b.WriteString("volumes:\n")
		for _, v := range in.Doc.Spec.Volumes {
			fmt.Fprintf(&b, "  fleet-%s_%s:\n", name, v.Name)
		}
	}
	out := b.String()
	if err := ValidateOutput(out, name); err != nil {
		return "", "", err
	}
	return out, RenderEnv(in.Doc.Spec.Env), nil
}

func writeList(b *strings.Builder, key string, items []string) {
	if len(items) == 0 {
		return
	}
	fmt.Fprintf(b, "%s:\n", key)
	for _, it := range items {
		fmt.Fprintf(b, "      - %s\n", it)
	}
}

func RenderEnv(env map[string]string) string {
	if len(env) == 0 {
		return ""
	}
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(env[k])
		b.WriteByte('\n')
	}
	return b.String()
}

var rePort = regexp.MustCompile(`^127\.0\.0\.1:[0-9]+:[0-9]+$`)

func ValidateOutput(yamlOut, svcName string) error {
	var raw map[string]any
	if err := yaml.Unmarshal([]byte(yamlOut), &raw); err != nil {
		return fmt.Errorf("compose_compile_failed: %w", err)
	}
	name, _ := raw["name"].(string)
	if name != "fleet-"+svcName {
		return fmt.Errorf("compose_compile_failed: name %q", name)
	}
	if strings.Contains(yamlOut, "privileged: true") {
		return fmt.Errorf("compose_compile_failed: privileged")
	}
	if strings.Contains(yamlOut, "network_mode: host") {
		return fmt.Errorf("compose_compile_failed: network_mode host")
	}
	svcs, _ := raw["services"].(map[string]any)
	app, _ := svcs["app"].(map[string]any)
	if app == nil {
		return fmt.Errorf("compose_compile_failed: missing app")
	}
	ports, _ := app["ports"].([]any)
	if len(ports) != 1 {
		return fmt.Errorf("compose_compile_failed: ports")
	}
	p, _ := ports[0].(string)
	if !rePort.MatchString(p) {
		return fmt.Errorf("compose_compile_failed: port %q", p)
	}
	if vols, ok := raw["volumes"].(map[string]any); ok {
		prefix := "fleet-" + svcName + "_"
		for k := range vols {
			if !strings.HasPrefix(k, prefix) {
				return fmt.Errorf("compose_compile_failed: volume %q", k)
			}
		}
	}
	return nil
}
