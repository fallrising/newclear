package spi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
)

// ErrClass classifies backend-independent storage errors.
type ErrClass string

const (
	// ErrBadRequest identifies invalid caller input.
	ErrBadRequest ErrClass = "bad_request"
	// ErrUnsupported identifies an unsupported operation.
	ErrUnsupported ErrClass = "unsupported"
	// ErrNotFound identifies a missing resource.
	ErrNotFound ErrClass = "not_found"
	// ErrTooLarge identifies a query or result beyond configured bounds.
	ErrTooLarge ErrClass = "too_large"
	// ErrThrottled identifies rate or concurrency limiting.
	ErrThrottled ErrClass = "throttled"
	// ErrUnavailable identifies a temporarily unavailable backend.
	ErrUnavailable ErrClass = "unavailable"
	// ErrTimeout identifies cancellation or deadline expiration.
	ErrTimeout ErrClass = "timeout"
	// ErrInternal identifies all other failures.
	ErrInternal ErrClass = "internal"
)

// Error adds a stable classification and operation context to a driver error.
type Error struct {
	Class  ErrClass
	Driver string
	Op     string
	Err    error
}

// Error formats a classified driver error.
func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s: %s: %v", e.Driver, e.Op, e.Class, e.Err)
}

// Unwrap returns the underlying driver error.
func (e *Error) Unwrap() error { return e.Err }

// Wrap constructs a classified Error, returning nil when err is nil.
func Wrap(class ErrClass, driver, op string, err error) error {
	if err == nil {
		return nil
	}
	return &Error{Class: class, Driver: driver, Op: op, Err: err}
}

// Classify returns the stable class for err.
func Classify(err error) ErrClass {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ErrTimeout
	}
	var classified *Error
	if errors.As(err, &classified) {
		return classified.Class
	}
	return ErrInternal
}

// Retryable reports whether an operation with class c may succeed on retry.
func Retryable(c ErrClass) bool {
	return c == ErrThrottled || c == ErrUnavailable || c == ErrTimeout
}

// HTTPStatus maps c to the compatibility API status code.
func HTTPStatus(c ErrClass) int {
	switch c {
	case ErrBadRequest, ErrUnsupported:
		return http.StatusBadRequest
	case ErrNotFound:
		return http.StatusNotFound
	case ErrTooLarge:
		return http.StatusUnprocessableEntity
	case ErrThrottled:
		return http.StatusTooManyRequests
	case ErrUnavailable, ErrTimeout:
		return http.StatusServiceUnavailable
	default:
		return http.StatusInternalServerError
	}
}

// PromErrorType maps c to the Prometheus API errorType value.
func PromErrorType(c ErrClass) string {
	switch c {
	case ErrBadRequest, ErrUnsupported:
		return "bad_data"
	case ErrNotFound:
		return "not_found"
	case ErrTooLarge:
		return "execution"
	case ErrThrottled, ErrUnavailable:
		return "unavailable"
	case ErrTimeout:
		return "timeout"
	default:
		return "internal"
	}
}
