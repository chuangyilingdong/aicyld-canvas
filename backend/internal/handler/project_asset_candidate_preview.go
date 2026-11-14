package handler

import (
	"net/http"

	localproject "infinite-canvas/backend/internal/project"

	"github.com/gin-gonic/gin"
)

func RegisterProjectAssetCandidatePreviewRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.PATCH("/projects/:id/asset-candidates/:candidateId/preview", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		var req localproject.UpdateProjectAssetCandidatePreviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		candidate, err := projects.UpdateProjectAssetCandidatePreview(user.ID, c.Param("id"), c.Param("candidateId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"candidate": candidate})
	})
}
