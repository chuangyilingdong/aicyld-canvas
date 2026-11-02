package model

import "time"

// CanvasOnboardingEvent is a deduplicated product funnel event. The unique
// key keeps retries from inflating the first-reach metrics.
type CanvasOnboardingEvent struct {
	ID        string    `json:"id" gorm:"primaryKey;size:64"`
	UserID    string    `json:"userId" gorm:"size:64;not null;uniqueIndex:idx_canvas_onboarding_event,priority:1;index"`
	Event     string    `json:"event" gorm:"size:64;not null;uniqueIndex:idx_canvas_onboarding_event,priority:2;index"`
	CanvasID  string    `json:"canvasId" gorm:"size:96;not null;uniqueIndex:idx_canvas_onboarding_event,priority:3;index"`
	TaskID    string    `json:"taskId,omitempty" gorm:"size:96"`
	CreatedAt time.Time `json:"createdAt" gorm:"index"`
}

func (CanvasOnboardingEvent) TableName() string { return "canvas_onboarding_events" }