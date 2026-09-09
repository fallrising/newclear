package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Duration is a YAML duration backed by time.Duration.
type Duration time.Duration

func (d Duration) String() string { return time.Duration(d).String() }

// Std returns d as a standard-library duration.
func (d Duration) Std() time.Duration { return time.Duration(d) }

func (d *Duration) UnmarshalText(text []byte) error {
	value := string(text)
	parsed, err := time.ParseDuration(value)
	if err != nil {
		if days, found := strings.CutSuffix(value, "d"); found {
			dayCount, dayErr := strconv.ParseInt(days, 10, 64)
			day := int64(24 * time.Hour)
			if dayErr == nil && dayCount <= math.MaxInt64/day && dayCount >= math.MinInt64/day {
				parsed, err = time.Duration(dayCount*day), nil
			}
		}
	}
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", text, err)
	}
	*d = Duration(parsed)
	return nil
}

func (d *Duration) UnmarshalYAML(unmarshal func(any) error) error {
	var text string
	if err := unmarshal(&text); err != nil {
		return err
	}
	return d.UnmarshalText([]byte(text))
}

func (d Duration) MarshalYAML() (any, error) { return d.String(), nil }

// ByteSize is a byte count encoded with IEC suffixes such as KiB or MiB.
type ByteSize int64

func (s ByteSize) String() string {
	value := int64(s)
	units := [...]struct {
		suffix     string
		multiplier int64
	}{
		{suffix: "TiB", multiplier: 1 << 40},
		{suffix: "GiB", multiplier: 1 << 30},
		{suffix: "MiB", multiplier: 1 << 20},
		{suffix: "KiB", multiplier: 1 << 10},
	}
	for _, unit := range units {
		if value != 0 && value%unit.multiplier == 0 {
			return strconv.FormatInt(value/unit.multiplier, 10) + unit.suffix
		}
	}
	return strconv.FormatInt(value, 10) + "B"
}

func (s *ByteSize) UnmarshalText(text []byte) error {
	value := strings.TrimSpace(string(text))
	units := [...]struct {
		suffix     string
		multiplier int64
	}{
		{suffix: "TiB", multiplier: 1 << 40},
		{suffix: "GiB", multiplier: 1 << 30},
		{suffix: "MiB", multiplier: 1 << 20},
		{suffix: "KiB", multiplier: 1 << 10},
		{suffix: "B", multiplier: 1},
	}
	for _, unit := range units {
		number, found := strings.CutSuffix(value, unit.suffix)
		if !found {
			continue
		}
		parsed, err := strconv.ParseInt(strings.TrimSpace(number), 10, 64)
		if err != nil {
			return fmt.Errorf("invalid byte size %q: %w", value, err)
		}
		if parsed > math.MaxInt64/unit.multiplier || parsed < math.MinInt64/unit.multiplier {
			return fmt.Errorf("byte size %q overflows int64", value)
		}
		*s = ByteSize(parsed * unit.multiplier)
		return nil
	}
	return fmt.Errorf("invalid byte size %q: use B, KiB, MiB, GiB, or TiB", value)
}

func (s *ByteSize) UnmarshalYAML(unmarshal func(any) error) error {
	var text string
	if err := unmarshal(&text); err != nil {
		return err
	}
	return s.UnmarshalText([]byte(text))
}

func (s ByteSize) MarshalYAML() (any, error) { return s.String(), nil }
