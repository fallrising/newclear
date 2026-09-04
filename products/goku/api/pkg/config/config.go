package config

import (
	"encoding/json"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port   int    `json:"port"`
	DBPath string `json:"db_path"`
	// Add other configuration fields here
}

func Load() (*Config, error) {
	// Load .env file if it exists (optional, for development convenience)
	godotenv.Load()

	// Load default config from JSON
	var cfg Config
	if err := loadJSON(&cfg); err != nil {
		return nil, err
	}

	// Override with environment variables if they exist
	if envPort := os.Getenv("PORT"); envPort != "" {
		if port, err := strconv.Atoi(envPort); err == nil {
			cfg.Port = port
		}
	}
	if envDBPath := os.Getenv("DB_PATH"); envDBPath != "" {
		cfg.DBPath = envDBPath
	}

	return &cfg, nil
}

func loadJSON(cfg *Config) error {
	file, err := os.Open("config.json")
	if err != nil {
		// If config.json doesn't exist, return default values
		*cfg = Config{
			Port:   8080,
			DBPath: "./goku.db",
		}
		return nil
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	return decoder.Decode(cfg)
}
