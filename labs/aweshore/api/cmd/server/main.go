package main

import (
	"aweshore/internal/app/handler"
	"aweshore/pkg/db"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"os"
)

func main() {
	// Configure logrus
	log.SetFormatter(&log.JSONFormatter{})
	log.SetOutput(os.Stdout)
	r := gin.Default()

	// Initialize the database
	db.Init()

	r.Use(GinErrorLoggingMiddleware())

	r.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:5173"},
		AllowMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE"},
		AllowHeaders: []string{"Origin", "Content-Type"},
	}))

	// Routes
	r.POST("/notes", handler.CreateNote)
	r.GET("/notes/:id", handler.GetNote)
	r.GET("/notes", handler.GetPaginatedNotes)
	r.PUT("/notes/:id", handler.UpdateNote)
	r.DELETE("/notes/:id", handler.DeleteNote)

	r.Run() // listen and serve on 0.0.0.0:8080
}

func GinErrorLoggingMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next() // Process request

		// Log errors that occurred during the request
		for _, e := range c.Errors {
			log.WithFields(log.Fields{
				"error": e.Error(),
				"path":  c.Request.URL.Path,
			}).Error("Request error")
		}
	}
}
