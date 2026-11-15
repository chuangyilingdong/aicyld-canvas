package handler

import (
	"net/http"

	localproject "infinite-canvas/backend/internal/project"

	"github.com/gin-gonic/gin"
)

func RegisterProjectShotArtifactRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.POST("/projects/:id/assets/:assetId/promote-visual", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req localproject.PromoteProjectAssetVisualRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := projects.PromoteProjectAssetVisual(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
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
