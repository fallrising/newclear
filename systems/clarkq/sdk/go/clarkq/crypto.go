package clarkq

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
)

// EncryptClientAES encrypts plaintext with AES-256-GCM for client encryption mode.
// Returns base64 ciphertext, encryption metadata for the API, and any error.
func EncryptClientAES(key []byte, plaintext []byte, keyID string) (body string, meta *EncryptionMeta, err error) {
	if len(key) != 32 {
		return "", nil, fmt.Errorf("AES-256 key must be 32 bytes, got %d", len(key))
	}
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", nil, err
	}
	ct := gcm.Seal(nil, nonce, plaintext, nil)
	if keyID == "" {
		keyID = "client-key"
	}
	return base64.StdEncoding.EncodeToString(ct), &EncryptionMeta{
		Mode:      "client",
		Algorithm: "aes-256-gcm",
		KeyID:     keyID,
		Nonce:     base64.StdEncoding.EncodeToString(nonce),
	}, nil
}

// DecryptClientAES decrypts a client-mode message body using the shared AES key.
func DecryptClientAES(key []byte, body string, meta *EncryptionMeta) ([]byte, error) {
	if meta == nil {
		return nil, errors.New("missing encryption metadata")
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("AES-256 key must be 32 bytes, got %d", len(key))
	}
	ct, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(meta.Nonce)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ct, nil)
}

// DecryptServerRSA decrypts a server_rsa-mode message with the client private key.
func DecryptServerRSA(priv *rsa.PrivateKey, body string, meta *EncryptionMeta) ([]byte, error) {
	if meta == nil {
		return nil, errors.New("missing encryption metadata")
	}
	if meta.EncryptedKey == "" || meta.Nonce == "" {
		return nil, errors.New("incomplete server_rsa metadata")
	}
	encDEK, err := base64.StdEncoding.DecodeString(meta.EncryptedKey)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(meta.Nonce)
	if err != nil {
		return nil, err
	}
	ct, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, err
	}
	dek, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, encDEK, nil)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ct, nil)
}

// LoadRSAPrivateKeyPEM loads a PKCS1 or PKCS8 RSA private key from PEM bytes.
func LoadRSAPrivateKeyPEM(pemData []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemData)
	if block == nil {
		return nil, errors.New("invalid private key PEM")
	}
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "PRIVATE KEY":
		key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		priv, ok := key.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("not an RSA private key")
		}
		return priv, nil
	default:
		return nil, fmt.Errorf("unsupported PEM type %q", block.Type)
	}
}

// LoadRSAPrivateKeyFile loads an RSA private key from a PEM file.
func LoadRSAPrivateKeyFile(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return LoadRSAPrivateKeyPEM(data)
}

// GenerateAES256Key returns a random 32-byte key for client mode.
func GenerateAES256Key() ([]byte, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	return key, nil
}
