// Example: go run ./sdk/go/example
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/sdk/go/clarkq"
)

func main() {
	base := env("CLARKQ_URL", "http://localhost:8080")
	key := os.Getenv("CLARKQ_API_KEY")
	client := clarkq.New(base, key)

	ctx := context.Background()
	if err := client.Health(ctx); err != nil {
		log.Fatal(err)
	}

	// Optional client-mode crypto demo when CLARKQ_DEMO_CRYPTO=1
	if os.Getenv("CLARKQ_DEMO_CRYPTO") == "1" {
		key, err := clarkq.GenerateAES256Key()
		if err != nil {
			log.Fatal(err)
		}
		body, meta, err := clarkq.EncryptClientAES(key, []byte("hello encrypted sdk"), "demo")
		if err != nil {
			log.Fatal(err)
		}
		res, err := client.Enqueue(ctx, "sdk-demo", body, map[string]string{"lang": "go"}, meta)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("enqueued encrypted id=%s\n", res.ID)
		msg, err := client.Dequeue(ctx, "sdk-demo", clarkq.ReadOptions{Timeout: 2 * time.Second})
		if err != nil {
			log.Fatal(err)
		}
		if msg == nil {
			log.Fatal("empty")
		}
		pt, err := clarkq.DecryptClientAES(key, msg.Body, msg.Encryption)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("decrypted body=%q\n", pt)
		return
	}

	res, err := client.Enqueue(ctx, "sdk-demo", "hello from go sdk", map[string]string{"lang": "go"}, nil)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("enqueued id=%s\n", res.ID)

	msg, err := client.Dequeue(ctx, "sdk-demo", clarkq.ReadOptions{Timeout: 2 * time.Second})
	if err != nil {
		log.Fatal(err)
	}
	if msg == nil {
		fmt.Println("queue empty")
		return
	}
	fmt.Printf("dequeued body=%q meta=%v\n", msg.Body, msg.Metadata)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
