package adapters

import (
	"crypto/rand"
	"encoding/binary"
	"time"
)

// SystemClock is the process wall clock for production wiring.
type SystemClock struct{}

func (SystemClock) Now() time.Time { return time.Now() }

func (SystemClock) NewTimer(duration time.Duration) Timer {
	return systemTimer{timer: time.NewTimer(duration)}
}

type systemTimer struct{ timer *time.Timer }

func (t systemTimer) C() <-chan time.Time               { return t.timer.C }
func (t systemTimer) Stop() bool                        { return t.timer.Stop() }
func (t systemTimer) Reset(duration time.Duration) bool { return t.timer.Reset(duration) }

// CryptoRandom draws from the operating system's random source.
type CryptoRandom struct{}

func (CryptoRandom) Uint64() (uint64, error) {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return 0, err
	}
	return binary.BigEndian.Uint64(buffer[:]), nil
}
