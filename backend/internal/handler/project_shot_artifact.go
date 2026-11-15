package handler

import (
	localproject "infinite-canvas/backend/internal/project"

	"github.com/gin-gonic/gin"
)

func RegisterProjectShotArtifactRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.PATCH("/projects/:id/shots/:shotId/artifacts/:artifactId/select", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		artifact, err := projects.SelectShotArtifact(user.ID, c.Param("id"), c.Param("shotId"), c.Param("artifactId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"artifact": artifact})
	})
}
