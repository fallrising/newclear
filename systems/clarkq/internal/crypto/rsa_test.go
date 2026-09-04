package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"path/filepath"
	"testing"
)

func TestRSAProviderRoundTrip(t *testing.T) {
	priv, pubPEM, err := generateKeyPair()
	if err != nil {
		t.Fatal(err)
	}

	provider, err := NewRSAProviderFromPublicKeyPEM(pubPEM)
	if err != nil {
		t.Fatal(err)
	}

	plaintext := []byte("secret queue payload")
	body, meta, err := provider.PrepareForStorage(plaintext, nil)
	if err != nil {
		t.Fatal(err)
	}
	if meta == nil || meta.EncryptedKey == "" || meta.Nonce == "" {
		t.Fatalf("missing encryption metadata: %#v", meta)
	}

	got, err := decryptWithPrivateKey(priv, body, meta)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(plaintext) {
		t.Fatalf("plaintext = %q, want %q", got, plaintext)
	}
}

func TestLoadRSAProviderRejectsMissingConfiguredKey(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing.pem")
	if _, _, err := LoadRSAProvider(missing, t.TempDir()); err == nil {
		t.Fatal("expected missing configured key to fail")
	}
}

func decryptWithPrivateKey(priv *rsa.PrivateKey, body string, meta *EncryptionMeta) ([]byte, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, err
	}
	encryptedDEK, err := base64.StdEncoding.DecodeString(meta.EncryptedKey)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(meta.Nonce)
	if err != nil {
		return nil, err
	}

	dek, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, encryptedDEK, nil)
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
	return gcm.Open(nil, nonce, ciphertext, nil)
}
