package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/fallrising/goku-consumer/internal/api"
	"github.com/fallrising/goku-consumer/internal/config"
	"github.com/fallrising/goku-consumer/internal/consumer"
	"github.com/fallrising/goku-consumer/internal/processor"
)

func main() {
	// Load configuration from environment variables
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	// Rest of the main function remains the same
	apiClient := api.NewClient(cfg.APIEndpoint)

	cons, err := consumer.New(cfg, func(msg []byte) error {
		return processor.ProcessMessage(msg, apiClient)
	})
	if err != nil {
		log.Fatal(err)
	}

	if err := cons.Start(); err != nil {
		log.Fatal(err)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh

	cons.Stop()
}
