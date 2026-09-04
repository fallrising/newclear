package crypto

import "testing"

func TestClientProviderRequiresMetadata(t *testing.T) {
	p := NewClientProvider()
	_, _, err := p.PrepareForStorage([]byte("cipher"), nil)
	if err != ErrInvalidEncryption {
		t.Fatalf("err = %v, want ErrInvalidEncryption", err)
	}
}

func TestClientProviderPassthrough(t *testing.T) {
	p := NewClientProvider()
	meta := &EncryptionMeta{
		Mode:      "client",
		Algorithm: "aes-256-gcm",
		KeyID:     "k1",
		Nonce:     "abc",
	}
	body, out, err := p.PrepareForStorage([]byte("cipher-text"), meta)
	if err != nil {
		t.Fatal(err)
	}
	if body != "cipher-text" || out != meta {
		t.Fatalf("body=%q meta=%#v", body, out)
	}
}