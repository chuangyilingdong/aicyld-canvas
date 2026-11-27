package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/operations"
)

// RegisterExternalGuardrailRoutes exposes the owner-only policy used by
// external MCP/CLI paid generation. External clients cannot read or edit it.
func RegisterExternalGuardrailRoutes(r gin.IRouter, svc *app.Service, desktopTrust func(*http.Request) bool) {
	r.GET("/agent-clients/guardrails", func(c *gin.Context) {
		if !requireDesktopUITrust(c, svc, desktopTrust) {
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, svc.ExternalGenerationGuardrailStatus(user.ID, time.Now()))
	})
	r.PUT("/agent-clients/guardrails", func(c *gin.Context) {
		if !requireDesktopUITrust(c, svc, desktopTrust) {
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req operations.ExternalGenerationGuardrail
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, operations.InvalidArg("invalid_params", "请填写有效的外部 Agent 护栏配置"))
			return
		}
		saved, err := svc.SetExternalGenerationGuardrail(user.ID, req)
		if err != nil {
			failAgentOps(c, err)
			return
		}
		ok(c, operations.ExternalGuardrailStatus{
			ExternalGenerationGuardrail: saved,
			TodaySpentCNY:               operations.TodayExternalEstimatedSpendCNY(svc.Database(), user.ID, time.Now()),
		})
	})
}

type externalPaidGuardrailService interface {
	CheckExternalBusinessPaidGuardrail(userID string) error
}

func requireExternalBusinessPaidGuard(c *gin.Context, svc externalPaidGuardrailService, userID string) bool {
	if _, external := externalBusiness(c); !external {
		return true
	}
	if svc == nil {
		failAgentOps(c, operations.Unsupported("guardrail_store_unavailable", "外部 Agent 护栏服务不可用"))
		return false
	}
	if err := svc.CheckExternalBusinessPaidGuardrail(userID); err != nil {
		failAgentOps(c, err)
		return false
	}
	return true
}
