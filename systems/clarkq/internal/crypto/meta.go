package crypto

import "errors"

type EncryptionMeta struct {
	Mode         string `json:"mode,omitempty"`
	Algorithm    string `json:"algorithm,omitempty"`
	KeyID        string `json:"key_id,omitempty"`
	Nonce        string `json:"nonce,omitempty"`
	EncryptedKey string `json:"encrypted_key,omitempty"`
}

var ErrInvalidEncryption = errors.New("invalid encryption metadata")