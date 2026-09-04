package crypto

import "strings"

type ClientProvider struct{}

func NewClientProvider() *ClientProvider {
	return &ClientProvider{}
}

func (p *ClientProvider) Mode() string {
	return "client"
}

func (p *ClientProvider) PrepareForStorage(body []byte, clientMeta *EncryptionMeta) (string, *EncryptionMeta, error) {
	if len(body) == 0 {
		return "", nil, ErrInvalidEncryption
	}
	if clientMeta == nil {
		return "", nil, ErrInvalidEncryption
	}
	if strings.TrimSpace(clientMeta.Mode) != "client" {
		return "", nil, ErrInvalidEncryption
	}
	if strings.TrimSpace(clientMeta.Algorithm) == "" {
		return "", nil, ErrInvalidEncryption
	}
	return string(body), clientMeta, nil
}

func (p *ClientProvider) PublicKeyPEM() (string, bool) {
	return "", false
}