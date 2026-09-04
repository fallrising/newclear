package auth

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrNoKey        = errors.New("no verification key available")
)

// JWTConfig configures JWT / OIDC bearer token validation.
type JWTConfig struct {
	// Issuer is the expected "iss" claim. Also used for OIDC discovery when JWKSURL is empty.
	Issuer string
	// Audience is the expected "aud" claim (optional but recommended).
	Audience string
	// JWKSURL is an explicit JWKS endpoint. Overrides discovery when set.
	JWKSURL string
	// HSSecret enables HS256 validation (useful for local/dev or shared-secret services).
	HSSecret string
	// RSAPublicKeyPEM enables static RS256 validation without JWKS.
	RSAPublicKeyPEM string
	// HTTPClient is used for JWKS/OIDC fetch; defaults to http.DefaultClient.
	HTTPClient *http.Client
	// JWKSCacheTTL controls how often remote keys are refreshed.
	JWKSCacheTTL time.Duration
}

// Enabled reports whether any JWT verification method is configured.
func (c JWTConfig) Enabled() bool {
	return c.Issuer != "" || c.JWKSURL != "" || c.HSSecret != "" || c.RSAPublicKeyPEM != ""
}

// Validator verifies bearer JWTs.
type Validator struct {
	cfg        JWTConfig
	httpClient *http.Client
	cacheTTL   time.Duration

	staticRSA *rsa.PublicKey

	mu        sync.RWMutex
	jwksURL   string
	keys      map[string]any // kid -> *rsa.PublicKey (or empty kid)
	keysAt    time.Time
	fetchErr  error
}

// NewValidator builds a JWT validator. Call Refresh once at startup if using remote JWKS.
func NewValidator(cfg JWTConfig) (*Validator, error) {
	if !cfg.Enabled() {
		return nil, nil
	}
	v := &Validator{
		cfg:        cfg,
		httpClient: cfg.HTTPClient,
		cacheTTL:   cfg.JWKSCacheTTL,
		keys:       make(map[string]any),
	}
	if v.httpClient == nil {
		v.httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	if v.cacheTTL <= 0 {
		v.cacheTTL = 5 * time.Minute
	}
	if cfg.RSAPublicKeyPEM != "" {
		pub, err := parseRSAPublicKeyPEM(cfg.RSAPublicKeyPEM)
		if err != nil {
			return nil, fmt.Errorf("jwt rsa public key: %w", err)
		}
		v.staticRSA = pub
	}
	if cfg.JWKSURL != "" {
		v.jwksURL = cfg.JWKSURL
	} else if cfg.Issuer != "" {
		// Resolve JWKS via OIDC discovery (best effort at construction; retry later).
		if err := v.resolveJWKSURL(context.Background()); err != nil {
			// Keep going — first Validate will retry.
			v.fetchErr = err
		}
	}
	return v, nil
}

var validMethods = []string{
	jwt.SigningMethodHS256.Alg(),
	jwt.SigningMethodHS384.Alg(),
	jwt.SigningMethodHS512.Alg(),
	jwt.SigningMethodRS256.Alg(),
	jwt.SigningMethodRS384.Alg(),
	jwt.SigningMethodRS512.Alg(),
}

// Validate checks a raw JWT string and returns claims on success.
func (v *Validator) Validate(ctx context.Context, tokenString string) (*Claims, error) {
	if v == nil {
		return nil, ErrInvalidToken
	}
	tokenString = strings.TrimSpace(tokenString)
	if tokenString == "" {
		return nil, ErrInvalidToken
	}

	opts := []jwt.ParserOption{
		jwt.WithValidMethods(validMethods),
		jwt.WithExpirationRequired(),
	}
	if v.cfg.Issuer != "" {
		opts = append(opts, jwt.WithIssuer(v.cfg.Issuer))
	}
	parser := jwt.NewParser(opts...)

	claims := &Claims{}
	token, err := parser.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		return v.keyFunc(ctx, t)
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("%w: %v", ErrInvalidToken, err)
	}

	if v.cfg.Audience != "" {
		ok := false
		for _, a := range claims.Audience {
			if a == v.cfg.Audience {
				ok = true
				break
			}
		}
		if !ok {
			return nil, fmt.Errorf("%w: audience mismatch", ErrInvalidToken)
		}
	}
	return claims, nil
}

func (v *Validator) keyFunc(ctx context.Context, t *jwt.Token) (any, error) {
	switch t.Method.(type) {
	case *jwt.SigningMethodHMAC:
		if v.cfg.HSSecret == "" {
			return nil, fmt.Errorf("%w: HS secret not configured", ErrNoKey)
		}
		return []byte(v.cfg.HSSecret), nil
	case *jwt.SigningMethodRSA:
		if v.staticRSA != nil {
			return v.staticRSA, nil
		}
		if err := v.ensureJWKS(ctx); err != nil {
			return nil, err
		}
		kid, _ := t.Header["kid"].(string)
		v.mu.RLock()
		key, ok := v.keys[kid]
		if !ok && kid != "" {
			// fall back to single anonymous key
			key, ok = v.keys[""]
		}
		if !ok && len(v.keys) == 1 {
			for _, k := range v.keys {
				key = k
				ok = true
				break
			}
		}
		v.mu.RUnlock()
		if !ok {
			// Force refresh once for key rotation.
			_ = v.refreshJWKS(ctx)
			v.mu.RLock()
			key, ok = v.keys[kid]
			if !ok {
				for _, k := range v.keys {
					key = k
					ok = true
					break
				}
			}
			v.mu.RUnlock()
		}
		if !ok {
			return nil, fmt.Errorf("%w: kid %q", ErrNoKey, kid)
		}
		return key, nil
	default:
		return nil, fmt.Errorf("unsupported signing method %T", t.Method)
	}
}

func (v *Validator) ensureJWKS(ctx context.Context) error {
	v.mu.RLock()
	fresh := time.Since(v.keysAt) < v.cacheTTL && len(v.keys) > 0
	v.mu.RUnlock()
	if fresh {
		return nil
	}
	return v.refreshJWKS(ctx)
}

func (v *Validator) resolveJWKSURL(ctx context.Context) error {
	issuer := strings.TrimRight(v.cfg.Issuer, "/")
	if issuer == "" {
		return errors.New("issuer required for OIDC discovery")
	}
	discURL := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discURL, nil)
	if err != nil {
		return err
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("oidc discovery status %d", resp.StatusCode)
	}
	var doc struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return err
	}
	if doc.JWKSURI == "" {
		return errors.New("oidc discovery missing jwks_uri")
	}
	v.mu.Lock()
	v.jwksURL = doc.JWKSURI
	v.mu.Unlock()
	return nil
}

func (v *Validator) refreshJWKS(ctx context.Context) error {
	v.mu.RLock()
	url := v.jwksURL
	v.mu.RUnlock()
	if url == "" && v.cfg.Issuer != "" {
		if err := v.resolveJWKSURL(ctx); err != nil {
			return err
		}
		v.mu.RLock()
		url = v.jwksURL
		v.mu.RUnlock()
	}
	if url == "" {
		return fmt.Errorf("%w: no JWKS URL", ErrNoKey)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks status %d", resp.StatusCode)
	}

	var set jwks
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return err
	}
	keys := make(map[string]any)
	for _, k := range set.Keys {
		if k.Kty != "RSA" {
			continue
		}
		pub, err := k.rsaPublicKey()
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 {
		return errors.New("jwks contained no usable RSA keys")
	}

	v.mu.Lock()
	v.keys = keys
	v.keysAt = time.Now()
	v.fetchErr = nil
	v.mu.Unlock()
	return nil
}

type jwks struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
	Alg string `json:"alg"`
	Use string `json:"use"`
}

func (k jwk) rsaPublicKey() (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, err
	}
	var eInt int
	for _, b := range eb {
		eInt = eInt<<8 + int(b)
	}
	if eInt == 0 {
		return nil, errors.New("invalid exponent")
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nb),
		E: eInt,
	}, nil
}

func parseRSAPublicKeyPEM(pemData string) (*rsa.PublicKey, error) {
	// Allow file path: if not PEM, try as file path is handled by config loader separately.
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
			return nil, errors.New("not RSA public key")
		}
		return rsaPub, nil
	case "RSA PUBLIC KEY":
		return x509.ParsePKCS1PublicKey(block.Bytes)
	default:
		return nil, fmt.Errorf("unsupported PEM type %q", block.Type)
	}
}

// LooksLikeJWT reports whether s has three base64url segments (header.payload.sig).
func LooksLikeJWT(s string) bool {
	parts := strings.Split(s, ".")
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != ""
}
