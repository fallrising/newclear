package group

import (
	"errors"
	"fmt"
)

type ErrorCode string

const (
	CodeIllegalGeneration   ErrorCode = "ILLEGAL_GENERATION"
	CodeNotOwner            ErrorCode = "NOT_OWNER"
	CodeRebalanceInProgress ErrorCode = "REBALANCE_IN_PROGRESS"
	CodeOffsetOutOfRange    ErrorCode = "OFFSET_OUT_OF_RANGE"
	CodeOffsetRegression    ErrorCode = "OFFSET_REGRESSION"
	CodeResourceExhausted   ErrorCode = "RESOURCE_EXHAUSTED"
	CodeUnknownTopic        ErrorCode = "UNKNOWN_TOPIC_OR_PARTITION"
	CodeInvalidRequest      ErrorCode = "INVALID_REQUEST"
	CodeRequestConflict     ErrorCode = "REQUEST_CONFLICT"
	CodeNotCoordinator      ErrorCode = "NOT_COORDINATOR"
	CodeDependencyFailed    ErrorCode = "DEPENDENCY_UNAVAILABLE"
)

type Error struct {
	Code    ErrorCode
	Message string
}

func (err *Error) Error() string { return err.Message }

func IsCode(err error, code ErrorCode) bool {
	var groupErr *Error
	return errors.As(err, &groupErr) && groupErr.Code == code
}

func groupError(code ErrorCode, format string, args ...any) error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}
