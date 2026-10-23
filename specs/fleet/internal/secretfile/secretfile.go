package secretfile

import (
	"os"
	"strings"
)

// Merge preserves dotenv quoting and multiline values. Compose resolves duplicate
// keys in order, so node-local secrets appended last retain override semantics.
func Merge(envFile, secretsPath string) (string, error) {
	if secretsPath == "" {
		return envFile, nil
	}
	b, err := os.ReadFile(secretsPath)
	if err != nil {
		return "", err
	}
	if envFile != "" && !strings.HasSuffix(envFile, "\n") {
		envFile += "\n"
	}
	return envFile + string(b), nil
}

func Exists(path string) bool {
	st, err := os.Stat(path)
	return err == nil && !st.IsDir()
}
