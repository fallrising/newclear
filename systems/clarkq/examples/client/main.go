// clarkQ 客戶端示例：認證、隊列讀寫、server_rsa / client 加解密。
//
// 用法:
//
//	# server_rsa：寫入明文，讀取後用私鑰解密
//	export CLARKQ_URL=http://localhost:8080
//	export CLARKQ_API_KEY=dev-key
//	go run ./examples/client -mode server_rsa -private-key .clarkq-keys/private.pem
//
//	# client E2E：客戶端加密後寫入，讀取後本地解密
//	go run ./examples/client -mode client -symmetric-key "base64:..."
//
//	# none：明文隊列
//	go run ./examples/client -mode none
package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const demoQueue = "demo-client"

func main() {
	mode := flag.String("mode", "none", "encryption mode to demo: none, server_rsa, client")
	baseURL := flag.String("url", envOr("CLARKQ_URL", "http://localhost:8080"), "clarkQ base URL")
	apiKey := flag.String("api-key", envOr("CLARKQ_API_KEY", ""), "API key (or set CLARKQ_API_KEY)")
	privateKeyPath := flag.String("private-key", ".clarkq-keys/private.pem", "RSA private key for server_rsa decrypt")
	symmetricKeyB64 := flag.String("symmetric-key", "", "base64 AES-256 key for client mode (auto-generated if empty)")
	flag.Parse()

	client := &http.Client{Timeout: 10 * time.Second}
	c := &clarkQClient{
		base:   strings.TrimRight(*baseURL, "/"),
		apiKey: *apiKey,
		http:   client,
	}

	fmt.Printf("clarkQ client demo  mode=%s  url=%s\n", *mode, c.base)

	serverMode, err := c.cryptoMode()
	if err != nil {
		fatal(err)
	}
	if serverMode != *mode {
		fatal(fmt.Errorf("server encryption mode is %q but -mode=%q; set CLARKQ_ENCRYPTION_MODE=%q on the server",
			serverMode, *mode, *mode))
	}

	switch *mode {
	case "none":
		runNone(c)
	case "server_rsa":
		runServerRSA(c, *privateKeyPath)
	case "client":
		runClient(c, *symmetricKeyB64)
	default:
		fmt.Fprintf(os.Stderr, "unknown mode %q\n", *mode)
		os.Exit(1)
	}
}

func runNone(c *clarkQClient) {
	plaintext := fmt.Sprintf("hello at %s", time.Now().Format(time.RFC3339))
	fmt.Println("\n[1] POST plaintext")
	if err := c.enqueue(demoQueue, plaintext, nil, nil); err != nil {
		fatal(err)
	}

	fmt.Println("[2] GET and print")
	msg, err := c.dequeue(demoQueue)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("    body: %s\n", msg.Body)
}

func runServerRSA(c *clarkQClient, privateKeyPath string) {
	priv, err := loadPrivateKey(privateKeyPath)
	if err != nil {
		fatal(fmt.Errorf("load private key: %w", err))
	}

	plaintext := fmt.Sprintf("secret payload %s", time.Now().Format(time.RFC3339))
	fmt.Println("\n[1] POST plaintext (server encrypts at rest)")
	if err := c.enqueue(demoQueue, plaintext, nil, nil); err != nil {
		fatal(err)
	}

	fmt.Println("[2] GET ciphertext")
	msg, err := c.dequeue(demoQueue)
	if err != nil {
		fatal(err)
	}
	if msg.Encryption == nil {
		fatal(fmt.Errorf("expected encryption metadata, got none"))
	}
	fmt.Printf("    stored body (truncated): %s...\n", truncate(msg.Body, 40))

	fmt.Println("[3] Decrypt with client private key")
	decrypted, err := decryptServerRSA(priv, msg.Body, msg.Encryption)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("    plaintext: %s\n", decrypted)
	if string(decrypted) != plaintext {
		fatal(fmt.Errorf("decrypted text mismatch"))
	}
	fmt.Println("    OK")
}

func runClient(c *clarkQClient, symmetricKeyB64 string) {
	key, generated, err := resolveSymmetricKey(symmetricKeyB64)
	if err != nil {
		fatal(err)
	}
	if generated {
		fmt.Printf("\n[i] Generated demo AES key (save for decrypt): base64:%s\n", base64.StdEncoding.EncodeToString(key))
	}

	plaintext := fmt.Sprintf("e2e secret %s", time.Now().Format(time.RFC3339))
	ciphertext, nonce, err := encryptAESGCM(key, []byte(plaintext))
	if err != nil {
		fatal(err)
	}

	enc := &encryptionMeta{
		Mode:      "client",
		Algorithm: "aes-256-gcm",
		KeyID:     "demo-key-v1",
		Nonce:     base64.StdEncoding.EncodeToString(nonce),
	}

	fmt.Println("\n[1] POST client-encrypted ciphertext")
	if err := c.enqueue(demoQueue, base64.StdEncoding.EncodeToString(ciphertext), nil, enc); err != nil {
		fatal(err)
	}

	fmt.Println("[2] GET ciphertext")
	msg, err := c.dequeue(demoQueue)
	if err != nil {
		fatal(err)
	}

	fmt.Println("[3] Decrypt locally")
	stored, err := base64.StdEncoding.DecodeString(msg.Body)
	if err != nil {
		fatal(err)
	}
	nonceBytes, err := base64.StdEncoding.DecodeString(msg.Encryption.Nonce)
	if err != nil {
		fatal(err)
	}
	decrypted, err := decryptAESGCM(key, nonceBytes, stored)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("    plaintext: %s\n", decrypted)
	if string(decrypted) != plaintext {
		fatal(fmt.Errorf("decrypted text mismatch"))
	}
	fmt.Println("    OK")
}

type clarkQClient struct {
	base   string
	apiKey string
	http   *http.Client
}

type encryptionMeta struct {
	Mode         string `json:"mode,omitempty"`
	Algorithm    string `json:"algorithm,omitempty"`
	KeyID        string `json:"key_id,omitempty"`
	Nonce        string `json:"nonce,omitempty"`
	EncryptedKey string `json:"encrypted_key,omitempty"`
}

type message struct {
	ID         string            `json:"id"`
	Queue      string            `json:"queue"`
	Body       string            `json:"body"`
	Metadata   map[string]string `json:"metadata"`
	Encryption *encryptionMeta   `json:"encryption"`
	CreatedAt  time.Time         `json:"created_at"`
}

func (c *clarkQClient) enqueue(queue, body string, metadata map[string]string, enc *encryptionMeta) error {
	payload := map[string]any{"body": body}
	if metadata != nil {
		payload["metadata"] = metadata
	}
	if enc != nil {
		payload["encryption"] = enc
	}
	data, _ := json.Marshal(payload)

	req, err := http.NewRequest(http.MethodPost, c.base+"/api/v1/queue/"+queue, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setAuth(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return readAPIError(resp)
	}
	return nil
}

func (c *clarkQClient) cryptoMode() (string, error) {
	req, err := http.NewRequest(http.MethodGet, c.base+"/api/v1/crypto/config", nil)
	if err != nil {
		return "", err
	}
	c.setAuth(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", readAPIError(resp)
	}

	var out struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.Mode, nil
}

func (c *clarkQClient) dequeue(queue string) (*message, error) {
	req, err := http.NewRequest(http.MethodGet, c.base+"/api/v1/queue/"+queue, nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNoContent {
		return nil, fmt.Errorf("queue %q is empty", queue)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, readAPIError(resp)
	}

	var msg message
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func (c *clarkQClient) setAuth(req *http.Request) {
	if c.apiKey != "" {
		req.Header.Set("X-API-Key", c.apiKey)
	}
}

func readAPIError(resp *http.Response) error {
	body, _ := io.ReadAll(resp.Body)
	var parsed struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(body, &parsed)
	if parsed.Error.Code != "" {
		return fmt.Errorf("HTTP %d %s: %s", resp.StatusCode, parsed.Error.Code, parsed.Error.Message)
	}
	return fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
}

func decryptServerRSA(priv *rsa.PrivateKey, body string, meta *encryptionMeta) ([]byte, error) {
	ciphertext, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, err
	}
	encryptedDEK, err := base64.StdEncoding.DecodeString(meta.EncryptedKey)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.StdEncoding.DecodeString(meta.Nonce)
	if err != nil {
		return nil, err
	}

	dek, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, priv, encryptedDEK, nil)
	if err != nil {
		return nil, err
	}
	return decryptAESGCM(dek, nonce, ciphertext)
}

func encryptAESGCM(key, plaintext []byte) (ciphertext, nonce []byte, err error) {
	nonce = make([]byte, 12)
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	return gcm.Seal(nil, nonce, plaintext, nil), nonce, nil
}

func decryptAESGCM(key, nonce, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func loadPrivateKey(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("invalid PEM")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("not an RSA private key")
	}
	return rsaKey, nil
}

func resolveSymmetricKey(value string) (key []byte, generated bool, err error) {
	if value != "" {
		raw := strings.TrimPrefix(value, "base64:")
		key, err = base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return nil, false, err
		}
		if len(key) != 32 {
			return nil, false, fmt.Errorf("symmetric key must be 32 bytes, got %d", len(key))
		}
		return key, false, nil
	}
	key = make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, false, err
	}
	return key, true, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}
