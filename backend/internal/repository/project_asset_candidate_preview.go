package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func visibleCandidatePreviews(db *gorm.DB) *gorm.DB {
	return db.Where("status <> ?", "deleted").Order("created_at desc, id desc")
}

func (r *Repository) UpsertProjectAssetCandidatePreviewActive(userID, projectID, candidateID string, expectedRevision int64, preview model.ProjectAssetCandidatePreview, selectPreview bool, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var candidate model.ProjectAssetCandidate
		if err := tx.First(&candidate, "id = ? AND project_id = ? AND status = ?", candidateID, projectID, "pending_confirmation").Error; err != nil {
			return err
		}
		preview.UserID = userID
		preview.ProjectID = projectID
		preview.CandidateID = candidateID
		preview.UpdatedAt = now
		if preview.CreatedAt.IsZero() {
			preview.CreatedAt = now
		}
		var existing model.ProjectAssetCandidatePreview
		found := false
		if preview.TaskID != "" {
			err := tx.Where("candidate_id = ? AND task_id = ? AND status <> ?", candidateID, preview.TaskID, "deleted").Order("created_at desc").First(&existing).Error
			switch {
			case err == nil:
				found = true
			case !errors.Is(err, gorm.ErrRecordNotFound):
				return err
			}
		}
		if found {
			preview.ID = existing.ID
			preview.CreatedAt = existing.CreatedAt
			preview.Selected = existing.Selected
			result := tx.Model(&model.ProjectAssetCandidatePreview{}).Where("id = ?", existing.ID).Updates(map[string]any{
				"resource_id": preview.ResourceID, "task_id": preview.TaskID, "model": preview.Model,
				"points": preview.Points, "status": preview.Status, "error": preview.Error, "updated_at": now,
			})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrInvalidData
			}
		} else if err := tx.Create(&preview).Error; err != nil {
			return err
		}
		if selectPreview {
			if preview.ResourceID == "" || preview.Status != "ready" {
				return gorm.ErrInvalidData
			}
			if err := tx.Model(&model.ProjectAssetCandidatePreview{}).
				Where("candidate_id = ? AND id <> ?", candidateID, preview.ID).
				Update("selected", false).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.ProjectAssetCandidatePreview{}).Where("id = ?", preview.ID).Update("selected", true).Error; err != nil {
				return err
			}
			result := tx.Model(&model.ProjectAssetCandidate{}).
				Where("id = ? AND project_id = ? AND status = ?", candidateID, projectID, "pending_confirmation").
				Updates(map[string]any{
					"preview_resource_id": preview.ResourceID,
					"preview_task_id":     preview.TaskID,
					"preview_status":      preview.Status,
					"preview_model":       preview.Model,
					"preview_points":      preview.Points,
					"updated_at":          now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrInvalidData
			}
		} else {
			if err := tx.Model(&model.ProjectAssetCandidate{}).Where("id = ? AND project_id = ?", candidateID, projectID).Update("updated_at", now).Error; err != nil {
				return err
			}
		}
		return bumpProjectRevisionCASTx(tx, projectID, expectedRevision, now)
	})
}

func (r *Repository) SelectProjectAssetCandidatePreviewActive(userID, projectID, candidateID, previewID string, expectedRevision int64, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var candidate model.ProjectAssetCandidate
		if err := tx.First(&candidate, "id = ? AND project_id = ? AND status = ?", candidateID, projectID, "pending_confirmation").Error; err != nil {
			return err
		}
		var preview model.ProjectAssetCandidatePreview
		if err := tx.First(&preview, "id = ? AND candidate_id = ? AND project_id = ? AND status = ?", previewID, candidateID, projectID, "ready").Error; err != nil {
			return err
		}
		if preview.ResourceID == "" {
			return gorm.ErrInvalidData
		}
		if err := tx.Model(&model.ProjectAssetCandidatePreview{}).Where("candidate_id = ?", candidateID).Update("selected", false).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.ProjectAssetCandidatePreview{}).Where("id = ?", previewID).Updates(map[string]any{"selected": true, "updated_at": now}).Error; err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).Where("id = ? AND project_id = ?", candidateID, projectID).Updates(map[string]any{
			"preview_resource_id": preview.ResourceID, "preview_task_id": preview.TaskID, "preview_status": "ready",
			"preview_model": preview.Model, "preview_points": preview.Points, "updated_at": now,
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

func (r *Repository) DeleteProjectAssetCandidatePreviewActive(userID, projectID, candidateID, previewID string, expectedRevision int64, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var candidate model.ProjectAssetCandidate
		if err := tx.First(&candidate, "id = ? AND project_id = ? AND status = ?", candidateID, projectID, "pending_confirmation").Error; err != nil {
			return err
		}
		var preview model.ProjectAssetCandidatePreview
		if err := tx.First(&preview, "id = ? AND candidate_id = ? AND project_id = ?", previewID, candidateID, projectID).Error; err != nil {
			return err
		}
		if preview.Selected {
			return gorm.ErrInvalidData
		}
		result := tx.Model(&model.ProjectAssetCandidatePreview{}).Where("id = ?", previewID).Updates(map[string]any{"status": "deleted", "selected": false, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return bumpProjectRevisionCASTx(tx, projectID, expectedRevision, now)
	})
}

// CleanupOrphanedProjectAssetCandidatePreviews removes history whose candidate
// disappeared and hard-deletes soft-deleted history after the retention window.
func (r *Repository) CleanupOrphanedProjectAssetCandidatePreviews(cutoff time.Time) (int64, error) {
	var total int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		orphaned := tx.Where("candidate_id NOT IN (SELECT id FROM project_asset_candidates)").Delete(&model.ProjectAssetCandidatePreview{})
		if orphaned.Error != nil {
			return orphaned.Error
		}
		total += orphaned.RowsAffected
		deleted := tx.Where("status = ? AND updated_at <= ?", "deleted", cutoff).Delete(&model.ProjectAssetCandidatePreview{})
		if deleted.Error != nil {
			return deleted.Error
		}
		total += deleted.RowsAffected
		return nil
	})
	return total, err
}
