package clickhouse

import (
	"context"
	"errors"
	"net"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const driverName = "clickhouse"

var (
	errClosed      = errors.New("backend closed")
	errDrift       = errors.New("schema migration drift")
	errWriteSchema = errors.New("ClickHouse insert schema mismatch")
)

// classifiedError discards server text while retaining cancellation identity.
func classifiedError(op string, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return spi.Wrap(spi.ErrTimeout, driverName, op, context.Canceled)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return spi.Wrap(spi.ErrTimeout, driverName, op, context.DeadlineExceeded)
	}
	if errors.Is(err, errDrift) {
		return spi.Wrap(spi.ErrInternal, driverName, op, errDrift)
	}
	if classified, ok := errors.AsType[*spi.Error](err); ok {
		return spi.Wrap(classified.Class, driverName, op, errors.New("operation failed"))
	}
	class := spi.ErrInternal
	if ex, ok := errors.AsType[*clickhouse.Exception](err); ok {
		switch ex.Code {
		case 209, 210, 60, 81, 516:
			class = spi.ErrUnavailable
		case 159:
			class = spi.ErrTimeout
		case 241, 158, 307, 396:
			class = spi.ErrTooLarge
		case 202:
			class = spi.ErrThrottled
		}
	} else if _, ok := errors.AsType[net.Error](err); ok {
		class = spi.ErrUnavailable
	}
	return spi.Wrap(class, driverName, op, errors.New("storage operation failed"))
}

func inputError(op, message string) error {
	return spi.Wrap(spi.ErrBadRequest, driverName, op, errors.New(message))
}
func unsupportedError(op, message string) error {
	return spi.Wrap(spi.ErrUnsupported, driverName, op, errors.New(message))
}
func closedError(op string) error { return spi.Wrap(spi.ErrUnavailable, driverName, op, errClosed) }
