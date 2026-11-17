package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	localproject "infinite-canvas/backend/internal/project"
)

// RegisterProjectAssetCandidateMutationRoutes owns the explicit confirm/ignore
// decisions for extracted assets. Keeping these routes together prevents the
// large project route file from growing every time a candidate action changes.
func RegisterProjectAssetCandidateMutationRoutes(r *gin.RouterGroup, owners workspaceOwners, projects *localproject.Service) {
	r.POST("/projects/:id/asset-candidates/:candidateId/confirm", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req localproject.ConfirmProjectAssetCandidateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := projects.ConfirmProjectAssetCandidate(user.ID, c.Param("id"), c.Param("candidateId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.POST("/projects/:id/asset-candidates/:candidateId/ignore", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		candidate, err := projects.IgnoreProjectAssetCandidate(user.ID, c.Param("id"), c.Param("candidateId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"candidate": candidate})
	})
}
