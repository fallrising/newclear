package crypto

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
	"path/filepath"
)

const (
	RSAAlgorithm     = "rsa-oaep-4096+aes-256-gcm"
	defaultRSAKeyDir = ".clarkq-keys"
	rsaKeyID         = "server-pubkey-v1"
)

type RSAProvider struct {
	publicKey *rsa.PublicKey
	keyID     string
}

func NewRSAProviderFromPublicKeyPEM(pemData string) (*RSAProvider, error) {
	pub, err := parsePublicKeyPEM(pemData)
	if err != nil {
		return nil, err
	}
	return &RSAProvider{publicKey: pub, keyID: rsaKeyID}, nil
}

func LoadRSAProvider(publicKeyPathOrPEM, keyDir string) (*RSAProvider, string, error) {
	if publicKeyPathOrPEM != "" {
		pemData, err := readKeyMaterial(publicKeyPathOrPEM)
		if err != nil {
			return nil, "", err
		}
		provider, err := NewRSAProviderFromPublicKeyPEM(pemData)
		return provider, pemData, err
	}

	dir := keyDir
	if dir == "" {
		dir = defaultRSAKeyDir
	}
	pubPath := filepath.Join(dir, "public.pem")
	privPath := filepath.Join(dir, "private.pem")

	if pubPEM, err := os.ReadFile(pubPath); err == nil {
		provider, err := NewRSAProviderFromPublicKeyPEM(string(pubPEM))
		return provider, string(pubPEM), err
	}

	priv, pubPEM, err := generateKeyPair()
	if err != nil {
		return nil, "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, "", err
	}
	if err := os.WriteFile(pubPath, []byte(pubPEM), 0o600); err != nil {
		return nil, "", err
	}
	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(priv),
	})
	if err := os.WriteFile(privPath, privPEM, 0o600); err != nil {
		return nil, "", err
	}

	provider, err := NewRSAProviderFromPublicKeyPEM(pubPEM)
	return provider, pubPEM, err
}

func (p *RSAProvider) Mode() string {
	return "server_rsa"
}

func (p *RSAProvider) PrepareForStorage(plaintext []byte, _ *EncryptionMeta) (string, *EncryptionMeta, error) {
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return "", nil, err
	}

	nonce := make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return "", nil, err
	}

	block, err := aes.NewCipher(dek)
	if err != nil {
		return "", nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", nil, err
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	encryptedDEK, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, p.publicKey, dek, nil)
	if err != nil {
		return "", nil, err
	}

	meta := &EncryptionMeta{
		Mode:         p.Mode(),
		Algorithm:    RSAAlgorithm,
		KeyID:        p.keyID,
		Nonce:        base64.StdEncoding.EncodeToString(nonce),
		EncryptedKey: base64.StdEncoding.EncodeToString(encryptedDEK),
	}
	return base64.StdEncoding.EncodeToString(ciphertext), meta, nil
}

func (p *RSAProvider) PublicKeyPEM() (string, bool) {
	der, err := x509.MarshalPKIXPublicKey(p.publicKey)
	if err != nil {
		return "", false
	}
	pemData := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	return string(pemData), true
}

func NewProvider(mode, publicKeyPathOrPEM, keyDir string) (Provider, string, error) {
	switch mode {
	case "", "none":
		return NewNoopProvider(), "", nil
	case "client":
		return NewClientProvider(), "", nil
	case "server_rsa":
		provider, pubPEM, err := LoadRSAProvider(publicKeyPathOrPEM, keyDir)
		return provider, pubPEM, err
	default:
		return nil, "", fmt.Errorf("unsupported encryption mode %q", mode)
	}
}

func parsePublicKeyPEM(pemData string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemData))
	if block == nil {
		return nil, errors.New("invalid public key PEM")
	}

	switch block.Type {
	case "PUBLIC KEY":
		pub, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, err
		}
		rsaPub, ok := pub.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("not an RSA public key")
		}
		return rsaPub, nil
	case "RSA PUBLIC KEY":
		return x509.ParsePKCS1PublicKey(block.Bytes)
	default:
		return nil, fmt.Errorf("unsupported PEM type %q", block.Type)
	}
}

func readKeyMaterial(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if looksLikePEM(value) {
		return value, nil
	}
	data, err := os.ReadFile(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func looksLikePEM(value string) bool {
	return len(value) > 27 && value[:27] == "-----BEGIN"
}

func generateKeyPair() (*rsa.PrivateKey, string, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, "", err
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		return nil, "", err
	}
	pubPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
	return priv, pubPEM, nil
}
