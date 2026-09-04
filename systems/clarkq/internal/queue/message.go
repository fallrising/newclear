package queue

import (
	"crypto/rand"
	"fmt"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/internal/crypto"
)

type Message struct {
	ID         string                `json:"id"`
	Queue      string                `json:"queue"`
	Body       string                `json:"body"`
	Metadata   map[string]string     `json:"metadata,omitempty"`
	Encryption *crypto.EncryptionMeta `json:"encryption,omitempty"`
	CreatedAt  time.Time             `json:"created_at"`
}

type EnqueueInput struct {
	Body       string
	Metadata   map[string]string
	Encryption *crypto.EncryptionMeta
}

type EnqueueResult struct {
	ID        string    `json:"id"`
	Queue     string    `json:"queue"`
	CreatedAt time.Time `json:"created_at"`
}

func newMessageID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
