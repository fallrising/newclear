package crypto

type Provider interface {
	Mode() string
	PrepareForStorage(plaintext []byte, clientMeta *EncryptionMeta) (body string, meta *EncryptionMeta, err error)
	PublicKeyPEM() (string, bool)
}