package server

import (
	"fmt"

	"github.com/fallrising/goku-api/pkg/config"
	"github.com/gin-gonic/gin"
)

type Server struct {
	router *gin.Engine
	config *config.Config
}

func NewServer(cfg *config.Config) *Server {
	router := gin.Default()

	return &Server{
		router: router,
		config: cfg,
	}
}

func (s *Server) AttachRouter(basePath string, routerFunc func(*gin.RouterGroup)) {
	group := s.router.Group(basePath)
	routerFunc(group)
}

func (s *Server) Run() error {
	return s.router.Run(fmt.Sprintf(":%d", s.config.Port))
}
