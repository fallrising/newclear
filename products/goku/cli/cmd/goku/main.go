package main

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"github.com/fallrising/goku-cli/cmd/goku/commands"
	"github.com/fallrising/goku-cli/internal/bookmarks"
	"github.com/fallrising/goku-cli/internal/database"
	"github.com/urfave/cli/v2"
)

func init() {
	setupLogging()
}

func main() {
	app := createApp()
	if err := app.Run(os.Args); err != nil {
		log.Fatal(err)
	}
}

func setupLogging() {
	logFile, err := os.OpenFile("goku.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0666)
	if err != nil {
		log.Fatalf("Error opening log file: %v", err)
	}
	log.SetOutput(logFile)
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
}

func createApp() *cli.App {
	app := &cli.App{
		Name:        "goku",
		Usage:       "A powerful CLI bookmark manager",
		Description: "Goku CLI helps you manage your bookmarks efficiently from the command line.",
		Version:     "1.0.0",
		Authors: []*cli.Author{
			{
				Name:  "KC",
				Email: "",
			},
		},
		Flags:    getGlobalFlags(),
		Commands: getCommands(),
		Before: func(c *cli.Context) error {
			bookmarkService := setupDatabases(c)
			c.App.Metadata["bookmarkService"] = bookmarkService
			return nil
		},
	}

	sort.Sort(cli.CommandsByName(app.Commands))
	cli.AppHelpTemplate = getCustomAppHelpTemplate()

	return app
}

func setupDatabases(c *cli.Context) *bookmarks.BookmarkService {
	user := c.String("user")
	dbPath := getEnvOrDefault(fmt.Sprintf("GOKU_DB_PATH_%s", strings.ToUpper(user)), fmt.Sprintf("%s.db", user))
	cacheDBPath := getEnvOrDefault(fmt.Sprintf("GOKU_CACHE_DB_PATH_%s", strings.ToUpper(user)), fmt.Sprintf("%s_cache.db", user))

	db, err := database.NewDatabase(dbPath, cacheDBPath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	if err := db.Init(); err != nil {
		log.Fatalf("Failed to initialize database schema: %v", err)
	}

	sqliteStats := database.NewSQLiteStats(db)

	return bookmarks.NewBookmarkService(db, sqliteStats)
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getGlobalFlags() []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{
			Name:    "db",
			EnvVars: []string{"GOKU_DB_PATH"},
			Value:   "goku.db",
			Usage:   "Path to the Goku database file",
		},
		&cli.StringFlag{
			Name:    "cache-db",
			EnvVars: []string{"GOKU_CACHE_DB_PATH"},
			Value:   "goku_cache.db",
			Usage:   "Path to the Goku cache database file",
		},
		&cli.StringFlag{
			Name:    "user",
			EnvVars: []string{"GOKU_USER"},
			Value:   "goku",
			Usage:   "User profile to use (determines which database to connect to)",
		},
	}
}

func getCommands() []*cli.Command {
	return []*cli.Command{
		commands.AddCommand(),
		commands.DeleteCommand(),
		commands.GetCommand(),
		commands.ListCommand(),
		commands.SearchCommand(),
		commands.UpdateCommand(),
		commands.ImportCommand(),
		commands.ExportCommand(),
		commands.TagsCommand(),
		commands.StatsCommand(),
		commands.PurgeCommand(),
		commands.FetchCommand(),
	}
}

func getCustomAppHelpTemplate() string {
	return `NAME:
   {{.Name}} - {{.Usage}}

DESCRIPTION:
   {{.Description}}

USAGE:
   {{.HelpName}} {{if .VisibleFlags}}[global options]{{end}}{{if .Commands}} command [command options]{{end}} {{if .ArgsUsage}}{{.ArgsUsage}}{{else}}[arguments...]{{end}}

VERSION:
   {{.Version}}

AUTHOR:
   {{range .Authors}}{{ . }}{{end}}

COMMANDS:
{{range .Commands}}   {{join .Names ", "}}{{ "\t"}}{{.Usage}}
{{end}}
GLOBAL OPTIONS:
{{range .VisibleFlags}}   {{.}}
{{end}}`
}
