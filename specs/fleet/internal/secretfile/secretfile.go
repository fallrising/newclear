package secretfile

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

// Merge spec env_file contents with optional secrets.env (KEY=VALUE lines).
func Merge(envFile, secretsPath string) (string, error) {
	out := map[string]string{}
	parseInto(envFile, out)
	if secretsPath != "" {
		b, err := os.ReadFile(secretsPath)
		if err != nil {
			if os.IsNotExist(err) {
				return "", err
			}
			return "", err
		}
		parseInto(string(b), out)
	}
	var b strings.Builder
	for k, v := range out {
		fmt.Fprintf(&b, "%s=%s\n", k, v)
	}
	return b.String(), nil
}

func parseInto(s string, out map[string]string) {
	sc := bufio.NewScanner(strings.NewReader(s))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[k] = v
	}
}

func Exists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
