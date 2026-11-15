package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) ShotArtifactForProject(projectID, artifactID string) (*model.ShotArtifact, error) {
	var artifact model.ShotArtifact
	if err := r.db.First(&artifact, "id = ? AND project_id = ?", artifactID, projectID).Error; err != nil {
		return nil, err
	}
	return &artifact, nil
}

func (r *Repository) SelectShotArtifactActive(userID, projectID, shotID, artifactID string, updatedAt time.Time) (*model.ShotArtifact, error) {
	var selected model.ShotArtifact
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ? AND project_id = ?", shotID, projectID).Error; err != nil {
			return err
		}
		if err := tx.First(&selected, "id = ? AND project_id = ? AND shot_id = ?", artifactID, projectID, shotID).Error; err != nil {
			return err
		}
		if selected.RevisionID != shot.CurrentRevisionID {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", shotID, selected.Type).Updates(map[string]any{"selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		result := tx.Model(&model.ShotArtifact{}).Where("id = ? AND shot_id = ? AND type = ?", artifactID, shotID, selected.Type).Updates(map[string]any{"selected": true, "updated_at": updatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		selected.Selected = true
		selected.UpdatedAt = updatedAt
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
	if err != nil {
		return nil, err
	}
	return &selected, nil
}
