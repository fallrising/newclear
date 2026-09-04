package crypto

type NoopProvider struct{}

func NewNoopProvider() *NoopProvider {
	return &NoopProvider{}
}

func (p *NoopProvider) Mode() string {
	return "none"
}

func (p *NoopProvider) PrepareForStorage(plaintext []byte, _ *EncryptionMeta) (string, *EncryptionMeta, error) {
	return string(plaintext), nil, nil
}

func (p *NoopProvider) PublicKeyPEM() (string, bool) {
	return "", false
}