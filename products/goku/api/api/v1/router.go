package v1

import (
	"github.com/fallrising/goku-api/internal/database"
	"github.com/fallrising/goku-api/internal/handlers/v1"
	"github.com/gin-gonic/gin"
	"net/http"
)

func SetupRoutes(db *database.Database) func(*gin.RouterGroup) {
	return func(router *gin.RouterGroup) {
		bookmarkHandler := handlers.NewBookmarkHandler(db)
		router.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
		})
		router.POST("/upload", bookmarkHandler.HandleUpload)
		router.GET("/bookmarks", bookmarkHandler.HandleGetAll)
		router.GET("/bookmark", bookmarkHandler.HandleGetByURL)
		router.PUT("/bookmark", bookmarkHandler.HandleUpdate)
		router.DELETE("/bookmark/:id", bookmarkHandler.HandleDelete)
	}
}
