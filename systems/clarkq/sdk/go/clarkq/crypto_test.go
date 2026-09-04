package clarkq

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func TestClientAESRoundTrip(t *testing.T) {
	key, err := GenerateAES256Key()
	if err != nil {
		t.Fatal(err)
	}
	body, meta, err := EncryptClientAES(key, []byte("hello"), "k1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Mode != "client" || meta.Nonce == "" {
		t.Fatalf("meta=%#v", meta)
	}
	pt, err := DecryptClientAES(key, body, meta)
	if err != nil || string(pt) != "hello" {
		t.Fatalf("pt=%q err=%v", pt, err)
	}
}

func TestServerRSADecryptMatchesServerShape(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	ct := gcm.Seal(nil, nonce, []byte("secret"), nil)
	encDEK, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, &priv.PublicKey, dek, nil)
	if err != nil {
		t.Fatal(err)
	}

	meta := &EncryptionMeta{
		Mode:         "server_rsa",
		Algorithm:    "rsa-oaep-4096+aes-256-gcm",
		KeyID:        "server-pubkey-v1",
		Nonce:        base64.StdEncoding.EncodeToString(nonce),
		EncryptedKey: base64.StdEncoding.EncodeToString(encDEK),
	}
	body := base64.StdEncoding.EncodeToString(ct)

	pt, err := DecryptServerRSA(priv, body, meta)
	if err != nil || string(pt) != "secret" {
		t.Fatalf("pt=%q err=%v", pt, err)
	}
}
