package promqltest

import (
	"crypto/sha256"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
)

//go:embed testdata/upstream/*
var corpus embed.FS

var corpusDriver = flag.String("driver", "memory", "corpus storage driver (only memory is implemented)")

var updateCorpus = flag.Bool("update-corpus", false, "regenerate reviewed corpus scope manifest")

var instantHeader = regexp.MustCompile(`^eval(?:_(?:fail|ordered))?\s+instant\s+(?:at\s+\S+)?\s+(.+)$`)
var rangeHeader = regexp.MustCompile(`^eval(?:_fail)?\s+range\s+from\s+\S+\s+to\s+\S+\s+step\s+\S+\s+(.+)$`)

type corpusCase struct {
	Line    int
	Command string
	Reason  string
}

type corpusAudit struct {
	Input          string
	Cases          []corpusCase
	HistogramLoads int
}

// auditCorpus classifies each eval using parsed selectors and loaded series,
// never filenames or function names. Classic histogram float series remain in scope.
// A selector matching a native/mixed series is explicitly outside the float SPI
// scope, even when the expected output itself contains only floats.
func auditCorpus(input string) (corpusAudit, error) {
	lines := strings.Split(input, "\n")
	clean := make([]string, len(lines))
	for i, line := range lines {
		clean[i] = strings.TrimSpace(line)
		if strings.HasPrefix(clean[i], "#") {
			clean[i] = ""
		}
	}
	var audit corpusAudit
	var retained []string
	native := map[string]labels.Labels{}
	for i := 0; i < len(clean); {
		line := clean[i]
		if line == "" {
			i++
			continue
		}
		if line == "clear" {
			clear(native)
			retained = append(retained, "clear", "")
			i++
			continue
		}
		end := i + 1
		for end < len(clean) && clean[end] != "" {
			end++
		}
		if strings.HasPrefix(line, "load ") {
			block := []string{line}
			for j := i + 1; j < end; j++ {
				metric, values, err := parser.ParseSeriesDesc(clean[j])
				if err != nil {
					return audit, fmt.Errorf("line %d: %w", j+1, err)
				}
				histogram := false
				for _, value := range values {
					histogram = histogram || value.Histogram != nil
				}
				if histogram {
					native[metric.String()] = metric
					audit.HistogramLoads++
				} else {
					block = append(block, clean[j])
				}
			}
			if len(block) > 1 {
				retained = append(retained, block...)
				retained = append(retained, "")
			}
		} else {
			parts := instantHeader.FindStringSubmatch(line)
			if parts == nil {
				parts = rangeHeader.FindStringSubmatch(line)
			}
			if parts == nil {
				return audit, fmt.Errorf("line %d: unknown command %q", i+1, line)
			}
			expr, err := parser.ParseExpr(parts[1])
			if err != nil {
				return audit, fmt.Errorf("line %d: %w", i+1, err)
			}
			entry := corpusCase{Line: i + 1, Command: line}
			// Inspect every selector, including those inside subqueries.
			parser.Inspect(expr, func(node parser.Node, _ []parser.Node) error {
				selector, ok := node.(*parser.VectorSelector)
				if !ok {
					return nil
				}
				for _, metric := range native {
					matches := true
					for _, matcher := range selector.LabelMatchers {
						matches = matches && matcher.Matches(metric.Get(matcher.Name))
					}
					if matches {
						entry.Reason = "selector matches loaded native or mixed histogram series"
					}
				}
				return nil
			})
			for j := i + 1; j < end; j++ {
				if _, err := strconv.ParseFloat(clean[j], 64); err == nil {
					continue
				}
				_, values, err := parser.ParseSeriesDesc(clean[j])
				if err != nil {
					return audit, fmt.Errorf("expected line %d: %w", j+1, err)
				}
				for _, value := range values {
					if value.Histogram != nil {
						entry.Reason = "expected native histogram sample"
					}
				}
			}
			audit.Cases = append(audit.Cases, entry)
			if entry.Reason == "" {
				retained = append(retained, clean[i:end]...)
				retained = append(retained, "")
			}
		}
		i = end
	}
	audit.Input = strings.Join(retained, "\n")
	return audit, nil
}

func TestCorpusAudit(t *testing.T) {
	previous := parser.EnableExperimentalFunctions
	parser.EnableExperimentalFunctions = true
	t.Cleanup(func() { parser.EnableExperimentalFunctions = previous })
	files, err := fs.Glob(corpus, "testdata/upstream/*.test")
	if err != nil {
		t.Fatal(err)
	}
	total, supported, histogramLoads := 0, 0, 0
	var manifest strings.Builder
	manifest.WriteString("# Prometheus v0.53.0 promql/promqltest/testdata; Apache-2.0\n# Each eval disposition is computed before evaluation; no outcome-based exclusion.\n")
	for _, name := range files {
		data, err := corpus.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		audit, err := auditCorpus(string(data))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		fmt.Fprintf(&manifest, "FILE\t%s\tSHA256=%x\tFILTERED_SHA256=%x\n", name, sha256.Sum256(data), sha256.Sum256([]byte(audit.Input)))
		floats := 0
		for _, entry := range audit.Cases {
			disposition := "float"
			if entry.Reason != "" {
				disposition = "outside-float-SPI: " + entry.Reason
			}
			fmt.Fprintf(&manifest, "EVAL\t%s:%d\t%s\t%s\n", name, entry.Line, disposition, entry.Command)
			if entry.Reason == "" {
				floats++
			}
		}
		t.Logf("%s SHA256=%x eval=%d float=%d native=%d histogram_load_lines=%d", name, sha256.Sum256(data), len(audit.Cases), floats, len(audit.Cases)-floats, audit.HistogramLoads)
		total += len(audit.Cases)
		supported += floats
		histogramLoads += audit.HistogramLoads
	}
	if len(files) != 12 || total != 768 || supported != 579 || total-supported != 189 || histogramLoads != 27 {
		t.Fatalf("pinned corpus coverage changed: files=%d eval=%d float=%d native=%d histogram_load_lines=%d", len(files), total, supported, total-supported, histogramLoads)
	}
	fmt.Fprintf(&manifest, "TOTAL\tfiles=%d\teval=%d\tfloat=%d\tnative=%d\thistogram_load_lines=%d\n", len(files), total, supported, total-supported, histogramLoads)
	const manifestPath = "testdata/corpus-manifest.tsv"
	if *updateCorpus {
		if err := os.WriteFile(manifestPath, []byte(manifest.String()), 0o600); err != nil {
			t.Fatal(err)
		}
	} else {
		expected, err := os.ReadFile(manifestPath)
		if err != nil {
			t.Fatal(err)
		}
		if string(expected) != manifest.String() {
			t.Fatal("corpus scope differs from reviewed manifest; investigate before using -update-corpus")
		}
	}
	t.Logf("TOTAL files=%d eval=%d float=%d native=%d histogram_load_lines=%d", len(files), total, supported, total-supported, histogramLoads)
}
