package spi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"testing"
)

func TestWrapAndClassify(t *testing.T) {
	t.Parallel()

	if got := Wrap(ErrInternal, "memory", "open", nil); got != nil {
		t.Fatalf("Wrap(nil) = %v, want nil", got)
	}
	wantErr := errors.New("backend unavailable")
	wrapped := Wrap(ErrUnavailable, "memory", "metrics.Write", wantErr)
	if !errors.Is(wrapped, wantErr) {
		t.Fatalf("Wrap() did not preserve the cause: %v", wrapped)
	}
	var classified *Error
	if !errors.As(wrapped, &classified) {
		t.Fatalf("Wrap() result is not *Error: %T", wrapped)
	}
	if classified.Driver != "memory" || classified.Op != "metrics.Write" || classified.Class != ErrUnavailable {
		t.Fatalf("Wrap() = %#v", classified)
	}
	if got, want := wrapped.Error(), "memory: metrics.Write: unavailable: backend unavailable"; got != want {
		t.Fatalf("Error() = %q, want %q", got, want)
	}
	if got := Classify(wrapped); got != ErrUnavailable {
		t.Fatalf("Classify() = %v, want unavailable", got)
	}
	if got := Classify(fmt.Errorf("outer: %w", wrapped)); got != ErrUnavailable {
		t.Fatalf("Classify(nested) = %v, want unavailable", got)
	}
	if got := Classify(errors.New("plain")); got != ErrInternal {
		t.Fatalf("Classify(plain) = %v, want internal", got)
	}
}

func TestClassifyContextErrors(t *testing.T) {
	t.Parallel()

	for _, err := range []error{
		context.Canceled,
		context.DeadlineExceeded,
		fmt.Errorf("wrapped: %w", context.Canceled),
		Wrap(ErrUnavailable, "driver", "op", context.DeadlineExceeded),
	} {
		if got := Classify(err); got != ErrTimeout {
			t.Errorf("Classify(%v) = %v, want timeout", err, got)
		}
	}
}

func TestErrorMappings(t *testing.T) {
	t.Parallel()

	tests := []struct {
		class      ErrClass
		retryable  bool
		httpStatus int
		promType   string
	}{
		{class: ErrBadRequest, httpStatus: http.StatusBadRequest, promType: "bad_data"},
		{class: ErrUnsupported, httpStatus: http.StatusBadRequest, promType: "bad_data"},
		{class: ErrNotFound, httpStatus: http.StatusNotFound, promType: "not_found"},
		{class: ErrTooLarge, httpStatus: http.StatusUnprocessableEntity, promType: "execution"},
		{class: ErrThrottled, retryable: true, httpStatus: http.StatusTooManyRequests, promType: "unavailable"},
		{class: ErrUnavailable, retryable: true, httpStatus: http.StatusServiceUnavailable, promType: "unavailable"},
		{class: ErrTimeout, retryable: true, httpStatus: http.StatusServiceUnavailable, promType: "timeout"},
		{class: ErrInternal, httpStatus: http.StatusInternalServerError, promType: "internal"},
		{class: ErrClass("future"), httpStatus: http.StatusInternalServerError, promType: "internal"},
	}
	for _, test := range tests {
		t.Run(string(test.class), func(t *testing.T) {
			t.Parallel()
			if got := Retryable(test.class); got != test.retryable {
				t.Errorf("Retryable() = %v, want %v", got, test.retryable)
			}
			if got := HTTPStatus(test.class); got != test.httpStatus {
				t.Errorf("HTTPStatus() = %d, want %d", got, test.httpStatus)
			}
			if got := PromErrorType(test.class); got != test.promType {
				t.Errorf("PromErrorType() = %q, want %q", got, test.promType)
			}
		})
	}
}
