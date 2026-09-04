package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestHS256Validate(t *testing.T) {
	v, err := NewValidator(JWTConfig{
		HSSecret: "super-secret",
		Issuer:   "clarkq-test",
		Audience: "clarkq-api",
	})
	if err != nil || v == nil {
		t.Fatalf("validator: %v", err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Issuer:    "clarkq-test",
		Audience:  []string{"clarkq-api"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		Subject:   "user-1",
	})
	signed, err := token.SignedString([]byte("super-secret"))
	if err != nil {
		t.Fatal(err)
	}

	claims, err := v.Validate(context.Background(), signed)
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-1" {
		t.Fatalf("sub=%q", claims.Subject)
	}
	_ = claims.Permissions()

	bad, _ := token.SignedString([]byte("wrong"))
	if _, err := v.Validate(context.Background(), bad); err == nil {
		t.Fatal("expected invalid token")
	}
}

func TestJWKSValidate(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub := &priv.PublicKey
	n := base64.RawURLEncoding.EncodeToString(pub.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes())

	mux := http.NewServeMux()
	var jwksURL string
	srv := httptest.NewServer(mux)
	defer srv.Close()

	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"issuer":   srv.URL,
			"jwks_uri": jwksURL,
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kty": "RSA",
				"kid": "k1",
				"n":   n,
				"e":   e,
				"alg": "RS256",
				"use": "sig",
			}},
		})
	})
	jwksURL = srv.URL + "/jwks"

	v, err := NewValidator(JWTConfig{
		Issuer:   srv.URL,
		Audience: "api",
	})
	if err != nil {
		t.Fatal(err)
	}

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.RegisteredClaims{
		Issuer:    srv.URL,
		Audience:  []string{"api"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})
	token.Header["kid"] = "k1"
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Validate(context.Background(), signed); err != nil {
		t.Fatal(err)
	}
}

func TestStaticRSAPublicKey(t *testing.T) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	pemData := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))

	v, err := NewValidator(JWTConfig{
		RSAPublicKeyPEM: pemData,
		Audience:        "svc",
	})
	if err != nil {
		t.Fatal(err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.RegisteredClaims{
		Audience:  []string{"svc"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	})
	signed, err := token.SignedString(priv)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.Validate(context.Background(), signed); err != nil {
		t.Fatal(err)
	}
}

func TestLooksLikeJWT(t *testing.T) {
	if !LooksLikeJWT("a.b.c") {
		t.Fatal("expected true")
	}
	if LooksLikeJWT("not-a-jwt") {
		t.Fatal("expected false")
	}
}
