package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) UpdateProjectAssetCandidatePreviewActive(userID, projectID, candidateID string, expectedRevision int64, resourceID, taskID, status string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).
			Where("id = ? AND project_id = ? AND status = ?", candidateID, projectID, "pending_confirmation").
			Updates(map[string]any{
				"preview_resource_id": resourceID,
				"preview_task_id":     taskID,
				"preview_status":      status,
				"updated_at":          now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return bumpProjectRevisionCASTx(tx, projectID, expectedRevision, now)
	})
}
