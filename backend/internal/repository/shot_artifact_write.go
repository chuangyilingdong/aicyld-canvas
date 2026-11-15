package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreateShotArtifact(artifact *model.ShotArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var currentVersion int
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		artifact.Version = currentVersion + 1
		if artifact.Selected {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(artifact).Error; err != nil {
			return err
		}
		if artifact.Status == "ready" {
			return tx.Model(&model.Shot{}).Where("id = ?", artifact.ShotID).Updates(shotReviewResetUpdatesWithTime(artifact.UpdatedAt)).Error
		}
		return nil
	})
}

func shotReviewResetUpdatesWithTime(updatedAt time.Time) map[string]any {
	return map[string]any{"review_status": "pending", "review_note": "", "review_revision_id": "", "reviewed_at": nil, "updated_at": updatedAt}
}
