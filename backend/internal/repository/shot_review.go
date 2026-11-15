package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) ReviewShotActive(userID, projectID, shotID, expectedRevisionID, status, note string, reviewedAt time.Time) (*model.Shot, error) {
	var shot model.Shot
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if shot.CurrentRevisionID != expectedRevisionID {
			return ErrProjectRevisionConflict
		}
		shot.ReviewStatus = status
		shot.ReviewNote = note
		shot.ReviewRevisionID = expectedRevisionID
		shot.ReviewedAt = &reviewedAt
		shot.UpdatedAt = reviewedAt
		if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shotID, projectID).Updates(map[string]any{
			"review_status": status, "review_note": note, "review_revision_id": expectedRevisionID,
			"reviewed_at": reviewedAt, "updated_at": reviewedAt,
		}).Error; err != nil {
			return err
		}
		return bumpProjectRevisionTx(tx, projectID, reviewedAt)
	})
	if err != nil {
		return nil, err
	}
	return &shot, nil
}
