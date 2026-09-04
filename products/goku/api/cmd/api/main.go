package main

import (
	"log"

	v1 "github.com/fallrising/goku-api/api/v1"
	"github.com/fallrising/goku-api/internal/database"
	"github.com/fallrising/goku-api/internal/server"
	"github.com/fallrising/goku-api/pkg/config"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := database.NewDatabase(cfg.DBPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Create server
	srv := server.NewServer(cfg)

	// Attach API routes
	srv.AttachRouter("/api/v1", v1.SetupRoutes(db))

	// Start the server
	log.Printf("Starting server on port %d", cfg.Port)
	if err := srv.Run(); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
