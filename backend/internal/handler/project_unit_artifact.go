package handler

import (
	"net/http"

	localproject "infinite-canvas/backend/internal/project"

	"github.com/gin-gonic/gin"
)

func RegisterProjectUnitArtifactRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.GET("/projects/:id/units/:unitId/artifacts", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		artifacts, err := projects.ProjectUnitArtifacts(user.ID, c.Param("id"), c.Param("unitId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"artifacts": artifacts})
	})
	r.POST("/projects/:id/units/:unitId/artifacts", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req localproject.RegisterProjectUnitArtifactRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		artifact, err := projects.RegisterProjectUnitArtifact(user.ID, c.Param("id"), c.Param("unitId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"artifact": artifact})
	})
}
