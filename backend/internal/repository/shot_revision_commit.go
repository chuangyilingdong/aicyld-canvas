package repository

import (
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) SaveShotWithRevisionActive(userID string, shot *model.Shot, revision *model.ShotRevision, create bool, expectedCurrentRevisionID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, shot.ProjectID); err != nil {
			return err
		}
		if strings.TrimSpace(shot.UnitID) != "" {
			if err := requireProjectUnitTx(tx, shot.ProjectID, shot.UnitID); err != nil {
				return err
			}
		}
		reviewReset := shotReviewResetUpdates()
		if create {
			if shot.ReviewStatus == "" {
				shot.ReviewStatus = "pending"
			}
			if err := tx.Create(shot).Error; err != nil {
				return err
			}
		} else {
			query := whereExpectedPointer(tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID), "current_revision_id", expectedCurrentRevisionID)
			updates := map[string]any{
				"unit_id": shot.UnitID, "title": shot.Title, "description": shot.Description, "position": shot.Position,
				"duration_ms": shot.DurationMs, "status": shot.Status, "updated_at": shot.UpdatedAt,
			}
			for key, value := range reviewReset {
				updates[key] = value
			}
			result := query.Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrProjectRevisionConflict
			}
		}
		var currentVersion int
		if err := tx.Model(&model.ShotRevision{}).Where("shot_id = ?", shot.ID).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		revision.Version = currentVersion + 1
		if err := tx.Create(revision).Error; err != nil {
			return err
		}
		shot.CurrentRevisionID = revision.ID
		updates := map[string]any{
			"current_revision_id": revision.ID, "description": shot.Description, "duration_ms": shot.DurationMs,
			"status": shot.Status, "updated_at": shot.UpdatedAt,
		}
		for key, value := range reviewReset {
			updates[key] = value
		}
		if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, shot.ProjectID).Updates(updates).Error; err != nil {
			return err
		}
		if !create {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": shot.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		if err := invalidateUnitWorkflowTx(tx, shot.ProjectID, shot.UnitID, "storyboard", shot.UpdatedAt); err != nil {
			return err
		}
		return bumpProjectRevisionTx(tx, shot.ProjectID, shot.UpdatedAt)
	})
}

func shotReviewResetUpdates() map[string]any {
	return map[string]any{"review_status": "pending", "review_note": "", "review_revision_id": "", "reviewed_at": nil}
}
