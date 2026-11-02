package handler

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/admin"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/repository"

	"github.com/gin-gonic/gin"
)

type canvasOnboardingService interface {
	RecordCanvasOnboardingEvent(userID string, eventName string, canvasID string, taskID string) error
	CanvasOnboardingFunnel(from, to time.Time) ([]repository.CanvasOnboardingFunnelRow, error)
}

func registerCanvasOnboardingRoutes(r *gin.RouterGroup, owners workspaceOwners, svc canvasOnboardingService) {
	r.POST("/canvas-onboarding/events", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "canvas-onboarding:"+user.ID, 60, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var request struct {
			Event    string `json:"event"`
			CanvasID string `json:"canvasId"`
			TaskID   string `json:"taskId"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, kernel.BadAuthRequest("漏斗事件格式无效"))
			return
		}
		if err := svc.RecordCanvasOnboardingEvent(user.ID, request.Event, request.CanvasID, request.TaskID); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"recorded": true})
	})

	r.GET("/admin/canvas-onboarding/funnel", func(c *gin.Context) {
		user, err := currentUser(c, owners)
		if err != nil {
			failService(c, err)
			return
		}
		if err := admin.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		now := time.Now().In(time.Local)
		from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local).AddDate(0, 0, -6)
		toDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
		if raw := c.Query("from"); raw != "" {
			parsed, parseErr := time.ParseInLocation("2006-01-02", raw, time.Local)
			if parseErr != nil {
				fail(c, http.StatusBadRequest, kernel.BadAuthRequest("开始日期无效"))
				return
			}
			from = parsed
		}
		if raw := c.Query("to"); raw != "" {
			parsed, parseErr := time.ParseInLocation("2006-01-02", raw, time.Local)
			if parseErr != nil {
				fail(c, http.StatusBadRequest, kernel.BadAuthRequest("结束日期无效"))
				return
			}
			toDate = parsed
		}
		to := toDate.AddDate(0, 0, 1)
		rows, err := svc.CanvasOnboardingFunnel(from, to)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{
			"from": from.Format("2006-01-02"), "to": toDate.Format("2006-01-02"), "events": rows,
		})
	})
}
