package port

import "time"

// Clock is the sole application source of wall-clock time.
type Clock interface {
	Now() time.Time
}
