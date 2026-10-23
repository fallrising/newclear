package fleetfile

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Config supplies host/domain policy used after JSON-Schema-shaped checks.
type Config struct {
	BaseDomain         string
	AllowedSuffixes    []string
	UIHostname         string
	APIHostname        string
	ProtectedHostnames []string
	RequireImage       bool
	NodeExists         func(id string) bool
}

// TestConfig is the default used by unit tests (SDD defaults).
func TestConfig() Config {
	return Config{
		BaseDomain:         "example.com",
		AllowedSuffixes:    []string{"example.com"},
		UIHostname:         "fleet.example.com",
		APIHostname:        "fleet-api.example.com",
		ProtectedHostnames: []string{"fleet.example.com", "fleet-api.example.com"},
	}
}

var (
	reName        = regexp.MustCompile(`^[a-z][a-z0-9-]{0,46}[a-z0-9]$`)
	reVolumeName  = regexp.MustCompile(`^[a-z][a-z0-9-]{0,30}[a-z0-9]$`)
	reEnvKey      = regexp.MustCompile(`^[A-Z_][A-Z0-9_]*$`)
	reLabelKey    = regexp.MustCompile(`^[a-z0-9][a-z0-9./-]{0,62}$`)
	reHealthPath  = regexp.MustCompile(`^/.*$`)
	reMemory      = regexp.MustCompile(`^[0-9]+[kKmMgG][iI]?[bB]?$`)
	reCPUs        = regexp.MustCompile(`^[0-9]+([.][0-9]+)?$`)
	reSecretInEnv = regexp.MustCompile(`(?i)(-----BEGIN|sk_live|ghp_|github_pat_|cfut_[A-Za-z0-9]{20,})`)
	reMount       = regexp.MustCompile(`^/.*$`)
)

const (
	maxName        = 48
	minName        = 2
	maxDescription = 512
	maxImage       = 512
	maxLabelVal    = 256
	maxWorkingDir  = 256
	maxUser        = 64
	maxHostname    = 253
	maxHealthPath  = 128
	maxEnvVal      = 4096
	maxCommand     = 32
	maxArgs        = 64
	maxSecrets     = 64
	maxVolumes     = 8
	maxMount       = 256
)

// Validate applies schema-shaped rules plus extra Go rules. It materializes
// hostname, healthPath, and desiredState defaults on doc.
func Validate(doc *Document, cfg Config) error {
	if doc == nil {
		return newError("invalid_json", "nil document")
	}
	ve := &Error{}

	if doc.APIVersion != APIVersionV1 {
		return newError("unsupported_version", fmt.Sprintf("unsupported apiVersion %q", doc.APIVersion))
	}
	if doc.Kind != KindService {
		ve.add("kind", "invalid_kind")
	}

	validateMetadata(ve, &doc.Metadata)
	validateSpec(ve, doc, cfg)

	if err := ve.finish(); err != nil {
		return err
	}
	applyDefaults(doc, cfg)
	validateAfterDefaults(ve, doc, cfg)
	return ve.finish()
}

func validateMetadata(ve *Error, m *Metadata) {
	if m.Name == "" {
		ve.add("metadata.name", "required")
	} else {
		if utf8.RuneCountInString(m.Name) < minName || utf8.RuneCountInString(m.Name) > maxName || !reName.MatchString(m.Name) {
			ve.add("metadata.name", "invalid_name")
		}
		if _, reserved := ReservedNames[m.Name]; reserved {
			ve.add("metadata.name", "name_reserved")
		}
	}
	if utf8.RuneCountInString(m.Description) > maxDescription {
		ve.add("metadata.description", "too_long")
	}
	for k, v := range m.Labels {
		if !reLabelKey.MatchString(k) {
			ve.add("metadata.labels."+k, "invalid_label_key")
		}
		if utf8.RuneCountInString(v) > maxLabelVal {
			ve.add("metadata.labels."+k, "too_long")
		}
	}
}

func validateSpec(ve *Error, doc *Document, cfg Config) {
	s := &doc.Spec
	if s.Node == "" {
		ve.add("spec.node", "required")
	} else if !reName.MatchString(s.Node) {
		ve.add("spec.node", "invalid_name")
	} else if cfg.NodeExists != nil && !cfg.NodeExists(s.Node) {
		ve.add("spec.node", "node_not_found")
	}

	if s.Image != "" && (utf8.RuneCountInString(s.Image) > maxImage) {
		ve.add("spec.image", "too_long")
	}
	if cfg.RequireImage && strings.TrimSpace(s.Image) == "" {
		ve.add("spec.image", "image_required")
	}

	if s.DesiredState != "" && s.DesiredState != StateRunning && s.DesiredState != StateStopped {
		ve.add("spec.desiredState", "invalid_enum")
	}
	if s.Replicas != nil && *s.Replicas != 1 {
		ve.add("spec.replicas", "invalid_const")
	}
	if len(s.Command) > maxCommand {
		ve.add("spec.command", "too_many")
	}
	if len(s.Args) > maxArgs {
		ve.add("spec.args", "too_many")
	}
	if utf8.RuneCountInString(s.WorkingDir) > maxWorkingDir {
		ve.add("spec.workingDir", "too_long")
	}
	if utf8.RuneCountInString(s.User) > maxUser {
		ve.add("spec.user", "too_long")
	}

	validateExpose(ve, &s.Expose)
	validateEnvSecrets(ve, s)
	validateVolumes(ve, s.Volumes)
	if s.Resources != nil {
		if s.Resources.Memory != "" && !reMemory.MatchString(s.Resources.Memory) {
			ve.add("spec.resources.memory", "invalid_memory")
		}
		if s.Resources.CPUs != "" && !reCPUs.MatchString(s.Resources.CPUs) {
			ve.add("spec.resources.cpus", "invalid_cpus")
		}
	}

	if s.DesiredState == StateRunning && strings.TrimSpace(s.Image) == "" && cfg.RequireImage {
		ve.add("spec.image", "image_required")
	}
}

func validateExpose(ve *Error, e *Expose) {
	switch e.Mode {
	case ModePublic, ModeAccess, ModePrivate:
	case "":
		ve.add("spec.expose.mode", "required")
	default:
		ve.add("spec.expose.mode", "invalid_enum")
	}
	if e.Port < 1 || e.Port > 65535 {
		ve.add("spec.expose.port", "invalid_port")
	}
	if e.HealthPath != "" {
		if utf8.RuneCountInString(e.HealthPath) > maxHealthPath || !reHealthPath.MatchString(e.HealthPath) {
			ve.add("spec.expose.healthPath", "invalid_health_path")
		}
	}
	if utf8.RuneCountInString(e.Hostname) > maxHostname {
		ve.add("spec.expose.hostname", "too_long")
	}
}

func validateEnvSecrets(ve *Error, s *Spec) {
	secretSet := map[string]struct{}{}
	for i, k := range s.Secrets {
		path := fmt.Sprintf("spec.secrets[%d]", i)
		if !reEnvKey.MatchString(k) {
			ve.add(path, "invalid_env_key")
			continue
		}
		if _, dup := secretSet[k]; dup {
			ve.add(path, "duplicate")
		}
		secretSet[k] = struct{}{}
	}
	if len(s.Secrets) > maxSecrets {
		ve.add("spec.secrets", "too_many")
	}
	for k, v := range s.Env {
		if !reEnvKey.MatchString(k) {
			ve.add("spec.env."+k, "invalid_env_key")
		}
		if utf8.RuneCountInString(v) > maxEnvVal {
			ve.add("spec.env."+k, "too_long")
		}
		if _, overlap := secretSet[k]; overlap {
			ve.add("spec.env."+k, "env_secret_overlap")
		}
		if reSecretInEnv.MatchString(v) {
			ve.add("spec.env."+k, "secret_in_env")
		}
	}
}

func validateVolumes(ve *Error, vols []Volume) {
	if len(vols) > maxVolumes {
		ve.add("spec.volumes", "too_many")
	}
	seen := map[string]struct{}{}
	for i, v := range vols {
		p := fmt.Sprintf("spec.volumes[%d]", i)
		if !reVolumeName.MatchString(v.Name) {
			ve.add(p+".name", "invalid_name")
		}
		if _, dup := seen[v.Name]; dup {
			ve.add(p+".name", "volume_name_dup")
		}
		seen[v.Name] = struct{}{}
		if utf8.RuneCountInString(v.Mount) > maxMount || !reMount.MatchString(v.Mount) {
			ve.add(p+".mount", "invalid_mount")
		}
	}
}

func applyDefaults(doc *Document, cfg Config) {
	if doc.Spec.DesiredState == "" {
		doc.Spec.DesiredState = StateRunning
	}
	if doc.Spec.Expose.HealthPath == "" {
		doc.Spec.Expose.HealthPath = "/healthz"
	}
	if doc.Spec.Expose.Hostname == "" {
		doc.Spec.Expose.Hostname = DefaultHostname(doc.Metadata.Name, doc.Spec.Expose.Mode, cfg)
	}
}

// DefaultHostname materializes a concrete FQDN.
func DefaultHostname(name, mode string, cfg Config) string {
	switch mode {
	case ModePrivate:
		return name + PrivateSuffix
	default:
		if cfg.BaseDomain == "" {
			return ""
		}
		return name + "." + cfg.BaseDomain
	}
}

func validateAfterDefaults(ve *Error, doc *Document, cfg Config) {
	host := normalizeHostname(doc.Spec.Expose.Hostname)
	doc.Spec.Expose.Hostname = host
	if host != "" && !validHostname(host) {
		ve.add("spec.expose.hostname", "invalid_hostname")
	}
	mode := doc.Spec.Expose.Mode

	if mode == ModePublic || mode == ModeAccess {
		if host == "" {
			ve.add("spec.expose.hostname", "hostname_required")
		} else if !hostnameAllowed(host, cfg) {
			ve.add("spec.expose.hostname", "hostname_not_allowed")
		}
	}
	if mode == ModePrivate {
		if host == "" || !strings.HasSuffix(strings.ToLower(host), PrivateSuffix) || inSuffixList(host, allowedSuffixes(cfg)) {
			ve.add("spec.expose.hostname", "private_hostname_invalid")
		}
	}

	if host != "" && isProtectedHostname(host, cfg) {
		ve.add("spec.expose.hostname", "hostname_protected")
	}

	if strings.EqualFold(doc.Metadata.Labels[LabelLargeOrigin], "true") && mode == ModePublic {
		ve.add("metadata.labels."+LabelLargeOrigin, "public_large_origin")
	}

	if doc.Spec.DesiredState == StateRunning && strings.TrimSpace(doc.Spec.Image) == "" && cfg.RequireImage {
		ve.add("spec.image", "image_required")
	}
}

func allowedSuffixes(cfg Config) []string {
	if len(cfg.AllowedSuffixes) > 0 {
		return cfg.AllowedSuffixes
	}
	if cfg.BaseDomain != "" {
		return []string{cfg.BaseDomain}
	}
	return nil
}

func hostnameAllowed(host string, cfg Config) bool {
	h := normalizeHostname(host)
	for _, suf := range allowedSuffixes(cfg) {
		s := strings.ToLower(strings.TrimPrefix(suf, "."))
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	return false
}

func inSuffixList(host string, suffixes []string) bool {
	h := normalizeHostname(host)
	for _, suf := range suffixes {
		s := strings.ToLower(strings.TrimPrefix(suf, "."))
		if s == "" {
			continue
		}
		if h == s || strings.HasSuffix(h, "."+s) {
			return true
		}
	}
	return false
}

func isProtectedHostname(host string, cfg Config) bool {
	h := normalizeHostname(host)
	check := func(p string) bool {
		return p != "" && normalizeHostname(p) == h
	}
	if check(cfg.UIHostname) || check(cfg.APIHostname) {
		return true
	}
	for _, p := range cfg.ProtectedHostnames {
		if check(p) {
			return true
		}
	}
	return false
}

// MaterializedHostname is the concrete FQDN stored on the catalog row.
func MaterializedHostname(doc *Document, cfg Config) string {
	if doc.Spec.Expose.Hostname != "" {
		return doc.Spec.Expose.Hostname
	}
	return DefaultHostname(doc.Metadata.Name, doc.Spec.Expose.Mode, cfg)
}

// Normalize absolute DNS names before policy comparisons and persistence.
func normalizeHostname(host string) string {
	return strings.ToLower(strings.TrimSuffix(host, "."))
}

func validHostname(host string) bool {
	if len(host) > 253 {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		for i, c := range label {
			if c >= 'a' && c <= 'z' || c >= '0' && c <= '9' {
				continue
			}
			if c == '-' && i > 0 && i < len(label)-1 {
				continue
			}
			return false
		}
	}
	return true
}
