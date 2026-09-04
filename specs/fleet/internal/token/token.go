package token

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	KindOperator  = "operator"
	KindAgent     = "agent"
	KindCI        = "ci"
	KindBootstrap = "bootstrap"

	PrefixOperator  = "flt_op_"
	PrefixAgent     = "flt_ag_"
	PrefixCI        = "flt_ci_"
	PrefixBootstrap = "flt_bs_"

	BootstrapTTL = 24 * time.Hour
)

var kindPrefix = map[string]string{
	KindOperator:  PrefixOperator,
	KindAgent:     PrefixAgent,
	KindCI:        PrefixCI,
	KindBootstrap: PrefixBootstrap,
}

func PrefixFor(kind string) (string, error) {
	p, ok := kindPrefix[kind]
	if !ok {
		return "", fmt.Errorf("unknown token kind %q", kind)
	}
	return p, nil
}

func KindFromPlain(plain string) string {
	switch {
	case strings.HasPrefix(plain, PrefixOperator):
		return KindOperator
	case strings.HasPrefix(plain, PrefixAgent):
		return KindAgent
	case strings.HasPrefix(plain, PrefixCI):
		return KindCI
	case strings.HasPrefix(plain, PrefixBootstrap):
		return KindBootstrap
	default:
		return ""
	}
}

func Hash(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}

// Issued is a newly generated token. Plaintext is shown once.
type Issued struct {
	ID     string
	Kind   string
	Prefix string
	Hash   string
	Plain  string
}

func Generate(kind string) (Issued, error) {
	pfx, err := PrefixFor(kind)
	if err != nil {
		return Issued{}, err
	}
	var rnd [16]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return Issued{}, err
	}
	hexstr := hex.EncodeToString(rnd[:])
	plain := pfx + hexstr
	id, err := NewID("tok")
	if err != nil {
		return Issued{}, err
	}
	return Issued{
		ID:     id,
		Kind:   kind,
		Prefix: pfx + hexstr[:4],
		Hash:   Hash(plain),
		Plain:  plain,
	}, nil
}

func NewReleaseID() (string, error) { return NewID("rel") }

func NewID(prefix string) (string, error) {
	u, err := newULID()
	if err != nil {
		return "", err
	}
	return prefix + "_" + u, nil
}

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func newULID() (string, error) {
	var buf [16]byte
	ms := uint64(time.Now().UTC().UnixMilli())
	buf[0] = byte(ms >> 40)
	buf[1] = byte(ms >> 32)
	buf[2] = byte(ms >> 24)
	buf[3] = byte(ms >> 16)
	buf[4] = byte(ms >> 8)
	buf[5] = byte(ms)
	if _, err := rand.Read(buf[6:]); err != nil {
		return "", err
	}
	// 26 crockford chars from 128 bits (26*5=130, two leftover bits zero).
	out := make([]byte, 26)
	var acc uint64
	var bits int
	idx := 0
	for _, b := range buf {
		acc = (acc << 8) | uint64(b)
		bits += 8
		for bits >= 5 && idx < 26 {
			bits -= 5
			out[idx] = crockford[(acc>>uint(bits))&31]
			idx++
		}
	}
	if idx < 26 {
		out[idx] = crockford[(acc<<uint(5-bits))&31]
	}
	return string(out), nil
}
