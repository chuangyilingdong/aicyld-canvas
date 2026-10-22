package handler

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/app"

	"github.com/gin-gonic/gin"
)

func registerMediaUpscaleRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/media-upscale/capabilities", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, svc.MediaUpscaleCapabilities())
	})
	for _, action := range []string{"estimate", "tasks"} {
		action := action
		r.POST("/media-upscale/"+action, func(c *gin.Context) {
			if !requireTrustedDesktopWritePrincipal(c, "视频超分只能由当前画布界面发起") {
				return
			}
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			policy, available := loadRuntimePolicy(c, svc)
			if !available || !enforceRateLimit(c, "media-upscale:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
			var request app.MediaUpscaleRequest
			if err := c.ShouldBindJSON(&request); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			if action == "estimate" {
				quote, err := svc.EstimateMediaUpscale(c.Request.Context(), user.ID, request)
				if err != nil {
					failService(c, err)
					return
				}
				ok(c, quote)
				return
			}
			task, err := svc.CreateMediaUpscale(c.Request.Context(), user.ID, request)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, task)
		})
	}
}
