package app

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

var canvasOnboardingEvents = map[string]struct{}{
	"canvas_created":   {},
	"canvas_opened":    {},
	"image_requested":  {},
	"video_requested":  {},
}

func (s *Service) RecordCanvasOnboardingEvent(userID string, eventName string, canvasID string, taskID string) error {
	eventName = strings.TrimSpace(eventName)
	canvasID = strings.TrimSpace(canvasID)
	taskID = strings.TrimSpace(taskID)
	if _, ok := canvasOnboardingEvents[eventName]; !ok {
		return kernel.BadAuthRequest("不支持的画布漏斗事件")
	}
	if canvasID == "" || len(canvasID) > 96 || !validCanvasEventIdentity(canvasID) {
		return kernel.BadAuthRequest("画布标识无效")
	}
	if len(taskID) > 96 || (taskID != "" && !validCanvasEventIdentity(taskID)) {
		return kernel.BadAuthRequest("任务标识无效")
	}
	return s.repo.RecordCanvasOnboardingEvent(&model.CanvasOnboardingEvent{
		ID: kernel.NewID(), UserID: userID, Event: eventName, CanvasID: canvasID, TaskID: taskID, CreatedAt: time.Now().UTC(),
	})
}

func (s *Service) CanvasOnboardingFunnel(actor *model.User, from, to time.Time) ([]repository.CanvasOnboardingFunnelRow, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if !to.After(from) || to.Sub(from) > 90*24*time.Hour {
		return nil, kernel.BadAuthRequest("统计时间范围必须为正数且不超过 90 天")
	}
	return s.repo.CanvasOnboardingFunnelSummary(from, to)
}

func validCanvasEventIdentity(value string) bool {
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == ':' || char == '.' {
			continue
		}
		return false
	}
	return true
}