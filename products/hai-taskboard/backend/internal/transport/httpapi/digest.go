package httpapi

import (
	"errors"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var ErrInvalidSHA256 = errors.New("invalid SHA256 wire digest")

const sha256Prefix = "sha256:"

// DecodeSHA256 translates the sole accepted OpenAPI SHA256 spelling into the
// prefix-free domain representation used by application and persistence code.
func DecodeSHA256(value string) (domain.Digest, error) {
	if len(value) != len(sha256Prefix)+64 || !strings.HasPrefix(value, sha256Prefix) {
		return domain.Digest{}, ErrInvalidSHA256
	}
	suffix := value[len(sha256Prefix):]
	for _, digit := range suffix {
		if digit < '0' || digit > '9' {
			if digit < 'a' || digit > 'f' {
				return domain.Digest{}, ErrInvalidSHA256
			}
		}
	}
	digest, err := domain.ParseDigest(suffix)
	if err != nil || digest.IsZero() {
		return domain.Digest{}, ErrInvalidSHA256
	}
	return digest, nil
}

// EncodeSHA256 adds exactly one wire prefix to a valid domain digest.
func EncodeSHA256(digest domain.Digest) (string, error) {
	if digest.IsZero() {
		return "", ErrInvalidSHA256
	}
	return sha256Prefix + digest.String(), nil
}
