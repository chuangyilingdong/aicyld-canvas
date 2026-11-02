package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm/clause"
)

type CanvasOnboardingFunnelRow struct {
	Event string `json:"event"`
	Count int64  `json:"count"`
	Users int64  `json:"users"`
}

func (r *Repository) RecordCanvasOnboardingEvent(event *model.CanvasOnboardingEvent) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(event).Error
}

func (r *Repository) CanvasOnboardingFunnelSummary(from, to time.Time) ([]CanvasOnboardingFunnelRow, error) {
	var rows []CanvasOnboardingFunnelRow
	err := r.db.Model(&model.CanvasOnboardingEvent{}).
		Select("event, count(*) AS count, count(DISTINCT user_id) AS users").
		Where("created_at >= ? AND created_at < ?", from, to).
		Group("event").
		Order("event").
		Scan(&rows).Error
	return rows, err
}