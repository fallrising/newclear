package testkit

import (
	"os"
	"strconv"
)

// ModelProfile returns the seed and event counts for a model suite: the
// suite's per-PR defaults, or MKFK_MODEL_SEEDS / MKFK_MODEL_EVENTS for the
// optional extended profile. An unparsable or non-positive override keeps
// the default, so a typo can never shrink the gate below it.
func ModelProfile(defaultSeeds, defaultEvents int) (seeds, events int) {
	return positiveEnv("MKFK_MODEL_SEEDS", defaultSeeds), positiveEnv("MKFK_MODEL_EVENTS", defaultEvents)
}

func positiveEnv(name string, fallback int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value < fallback {
		return fallback
	}
	return value
}
