package queue

import "errors"

var (
	ErrInvalidName     = errors.New("invalid queue name")
	ErrQueueNotFound   = errors.New("queue not found")
	ErrQueueEmpty      = errors.New("queue is empty")
	ErrQueueFull       = errors.New("queue is full")
	ErrQueueLimit      = errors.New("queue limit reached")
	ErrMessageTooLarge = errors.New("message too large")
	ErrEmptyBody       = errors.New("message body is empty")
)