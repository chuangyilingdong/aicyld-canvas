package handler

import (
	"errors"
	"net/http"
	"strconv"

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
	r.POST("/projects/:id/asset-candidates/:candidateId/previews/:previewId/select", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req localproject.SelectProjectAssetCandidatePreviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		candidate, err := projects.SelectProjectAssetCandidatePreview(user.ID, c.Param("id"), c.Param("candidateId"), c.Param("previewId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"candidate": candidate})
	})
	r.DELETE("/projects/:id/asset-candidates/:candidateId/previews/:previewId", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		expectedRevision, err := strconv.ParseInt(c.Query("expectedRevision"), 10, 64)
		if err != nil || expectedRevision <= 0 {
			fail(c, http.StatusBadRequest, errors.New("expectedRevision must be a positive integer"))
			return
		}
		candidate, err := projects.DeleteProjectAssetCandidatePreview(user.ID, c.Param("id"), c.Param("candidateId"), c.Param("previewId"), expectedRevision)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"candidate": candidate})
	})
}
