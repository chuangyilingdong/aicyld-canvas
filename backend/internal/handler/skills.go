package handler

import (
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/model"

	"github.com/gin-gonic/gin"
)

func RegisterSkillRoutes(r *gin.RouterGroup, svc *app.Service) {
	registerSkillRoutes(r, svc, true)
}

// RegisterDesktopSkillRoutes keeps local skill files available while removing
// GitHub-backed installation and synchronization from the desktop API.
func RegisterDesktopSkillRoutes(r *gin.RouterGroup, svc *app.Service) {
	registerSkillRoutes(r, svc, false)
}

func registerSkillRoutes(r *gin.RouterGroup, svc *app.Service, includeRemote bool) {
	r.POST("/skills/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, app.SkillPackageUploadMaxBytes)
		file, err := c.FormFile("file")
		if err != nil {
			failService(c, app.BadAuthRequest("请选择 Markdown 或 ZIP 技能文件"))
			return
		}
		isPrivate, err := parseOptionalBool(c.PostForm("isPrivate"))
		if err != nil {
			failService(c, app.BadAuthRequest("isPrivate 必须是布尔值"))
			return
		}
		sourceType := strings.ToLower(strings.TrimSpace(c.PostForm("sourceType")))
		if sourceType == "" {
			switch strings.ToLower(filepath.Ext(file.Filename)) {
			case ".md", ".markdown":
				sourceType = "markdown"
			case ".zip":
				sourceType = "zip"
			}
		}
		skill, err := svc.InstallSkillUpload(user.ID, sourceType, file, app.SkillInstallRequest{
			Name: c.PostForm("name"), Description: c.PostForm("description"), Tag: c.PostForm("tag"), IsPrivate: isPrivate,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	if includeRemote {
		r.POST("/skills/install/github", func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
			var req app.SkillGitHubInstallRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				failService(c, app.BadAuthRequest("GitHub 技能数据格式无效"))
				return
			}
			skill, err := svc.InstallGitHubSkill(user.ID, req)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"skill": skill})
		})
	}

	r.GET("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.Skills(user.ID, app.SkillListRequest{
			Page: page, PageSize: pageSize, Scope: c.DefaultQuery("scope", "public"),
			Search: c.Query("search"), Tag: c.Query("tag"), Sort: c.DefaultQuery("sort", "popular"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/skills/added", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skills, err := svc.AddedSkills(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": skills})
	})

	r.GET("/skills/review/submissions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.SkillSubmissionReviewQueue(user.ID, user.Role == model.UserRoleAdmin, c.Query("status"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})

	r.GET("/skills/review/submissions/:submissionId/files", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		files, err := svc.SkillSubmissionFiles(user.ID, user.Role == model.UserRoleAdmin, c.Param("submissionId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"files": files})
	})

	r.GET("/skills/review/submissions/:submissionId/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		file, err := svc.SkillSubmissionFile(user.ID, user.Role == model.UserRoleAdmin, c.Param("submissionId"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"file": file})
	})

	r.POST("/skills/review/submissions/:submissionId/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req app.SkillReviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, app.BadAuthRequest("审核数据格式无效"))
			return
		}
		item, err := svc.ReviewSkillSubmission(user.ID, user.Role == model.UserRoleAdmin, c.Param("submissionId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"submission": item})
	})

	r.GET("/skills/:id/submissions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.SkillSubmissionHistory(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})

	r.POST("/skills/:id/submissions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req app.SkillSubmissionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, app.BadAuthRequest("投稿数据格式无效"))
			return
		}
		item, err := svc.PrepareSkillSubmission(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"submission": item})
	})

	r.POST("/skills/submissions/:submissionId/submit", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req app.SkillSubmissionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, app.BadAuthRequest("投稿数据格式无效"))
			return
		}
		item, err := svc.SubmitSkillSubmission(user.ID, c.Param("submissionId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"submission": item})
	})

	r.DELETE("/skills/submissions/:submissionId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		item, err := svc.WithdrawSkillSubmission(user.ID, c.Param("submissionId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"submission": item})
	})

	r.GET("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SkillDetail(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.GET("/skills/:id/files", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		files, err := svc.SkillPackageFiles(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"files": files})
	})

	r.GET("/skills/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		file, err := svc.SkillPackageFile(user.ID, c.Param("id"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"file": file})
	})

	r.GET("/skills/:id/file/raw", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, mimeType, fileName, err := svc.SkillPackageRawFile(user.ID, c.Param("id"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
		c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": fileName}))
		c.Data(http.StatusOK, mimeType, data)
	})

	r.GET("/skills/:id/bundle", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		bundle, err := svc.SkillPackageBundle(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"bundle": bundle})
	})

	r.GET("/skills/:id/search", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		results, err := svc.SearchSkillPackage(user.ID, c.Param("id"), c.Query("q"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"results": results})
	})

	if includeRemote {
		r.POST("/skills/:id/sync", func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			skill, err := svc.SyncGitHubSkill(user.ID, c.Param("id"))
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"skill": skill})
		})
	}

	r.POST("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req app.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, app.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.CreateSkill(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.POST("/skills/:id/package", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, app.SkillPackageUploadMaxBytes)
		file, err := c.FormFile("file")
		if err != nil {
			failService(c, app.BadAuthRequest("请选择 Markdown 或 ZIP 技能文件"))
			return
		}
		skill, err := svc.ReplaceSkillPackage(user.ID, c.Param("id"), c.PostForm("sourceType"), file, app.SkillInstallRequest{
			Name: c.PostForm("name"), Description: c.PostForm("description"), Tag: c.PostForm("tag"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.PUT("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req app.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, app.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.UpdateSkill(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.DELETE("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSkill(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.POST("/skills/:id/add", setSkillAdded(svc, true))
	r.DELETE("/skills/:id/add", setSkillAdded(svc, false))
	r.GET("/skills/:id/versions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		versions, err := svc.SkillVersions(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"versions": versions})
	})
	r.PATCH("/skills/:id/enabled", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.Enabled == nil {
			fail(c, 400, err)
			return
		}
		skill, err := svc.SetSkillEnabled(user.ID, c.Param("id"), *body.Enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.POST("/skills/:id/rollback", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			VersionID string `json:"versionId"`
		}
		if err := c.ShouldBindJSON(&body); err != nil || body.VersionID == "" {
			fail(c, 400, err)
			return
		}
		skill, err := svc.RollbackSkillVersion(user.ID, c.Param("id"), body.VersionID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.POST("/skills/:id/rewrite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.CreatePrivateSkillRewrite(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.POST("/skills/:id/like", setSkillLiked(svc, true))
	r.DELETE("/skills/:id/like", setSkillLiked(svc, false))
}

func parseOptionalBool(value string) (bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return false, nil
	}
	return strconv.ParseBool(value)
}

func setSkillAdded(svc *app.Service, added bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillAdded(user.ID, c.Param("id"), added)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}

func setSkillLiked(svc *app.Service, liked bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillLiked(user.ID, c.Param("id"), liked)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}
