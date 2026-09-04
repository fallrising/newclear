// Package version holds build-time identity for clarkQ releases.
package version

// These are overridden via -ldflags at build time.
var (
	Version = "1.5.1"
	Commit  = "unknown"
	Date    = "unknown"
)

// Info is returned by /version and embedded in /health.
type Info struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	Date    string `json:"date"`
}

func Get() Info {
	return Info{Version: Version, Commit: Commit, Date: Date}
}
