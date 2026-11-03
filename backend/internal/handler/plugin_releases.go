package handler

import (
	"io"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"

	"github.com/gin-gonic/gin"
)

func registerPluginReleaseRoutes(r *gin.RouterGroup, center pluginCenter) {
	releases := r.Group("/releases")

	releases.GET("", func(c *gin.Context) {
		user, err := currentUser(c, center)
		if err == nil {
			err = center.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		items, err := center.PluginReleasesForAdmin(user, c.Query("pluginId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"releases": items})
	})

	releases.POST("", func(c *gin.Context) {
		user, err := currentUser(c, center)
		if err == nil {
			err = center.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		data, fileName, err := readPluginPackageRequest(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		releaseNotes := strings.TrimSpace(c.PostForm("releaseNotes"))
		if releaseNotes == "" {
			releaseNotes = strings.TrimSpace(c.Query("releaseNotes"))
		}
		view, err := center.UploadPluginReleaseForAdmin(user, data, fileName, releaseNotes)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})

	releases.GET("/:releaseId", func(c *gin.Context) {
		user, err := currentUser(c, center)
		if err == nil {
			err = center.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		view, err := center.PluginReleaseForAdmin(user, c.Param("releaseId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})

	releases.GET("/:releaseId/package", func(c *gin.Context) {
		user, err := currentUser(c, center)
		if err == nil {
			err = center.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		data, release, err := center.PluginReleasePackageForAdmin(user, c.Param("releaseId"))
		if err != nil {
			failService(c, err)
			return
		}
		fileName := strings.TrimSpace(release.PluginID) + "-" + strings.TrimSpace(release.Version) + protocol.PluginPackageExtension
		c.Header("Cache-Control", "private, no-store")
		c.Header("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(fileName, "\"", "")+"\"")
		c.Data(http.StatusOK, "application/zip", data)
	})

	releases.POST("/:releaseId/submit", func(c *gin.Context) {
		user, err := currentUser(c, center)
		if err == nil {
			err = center.RequireAdmin(user)
		}
		if err != nil {
			failService(c, err)
			return
		}
		view, err := center.SubmitPluginReleaseForAdmin(user, c.Param("releaseId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})

	releases.POST("/:releaseId/approve", func(c *gin.Context) {
		user, notes, err := pluginReleaseReviewRequest(c, center)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := center.ApprovePluginReleaseForAdmin(user, c.Param("releaseId"), notes)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})

	releases.POST("/:releaseId/reject", func(c *gin.Context) {
		user, notes, err := pluginReleaseReviewRequest(c, center)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := center.RejectPluginReleaseForAdmin(user, c.Param("releaseId"), notes)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
}

func pluginReleaseReviewRequest(c *gin.Context, center pluginCenter) (*model.User, string, error) {
	user, err := currentUser(c, center)
	if err == nil {
		err = center.RequireAdmin(user)
	}
	if err != nil {
		return nil, "", err
	}
	var request struct {
		Notes string `json:"notes"`
	}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&request); err != nil {
			return nil, "", err
		}
	}
	return user, strings.TrimSpace(request.Notes), nil
}

func readPluginPackageRequest(c *gin.Context) ([]byte, string, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, protocol.PluginPackageMaxBytes)
	if strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			return nil, "", err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, protocol.PluginPackageMaxBytes+1))
		return data, header.Filename, err
	}
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, protocol.PluginPackageMaxBytes+1))
	return data, "", err
}
