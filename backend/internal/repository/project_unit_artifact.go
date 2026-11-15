package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) ProjectUnitArtifacts(projectID, unitID string) ([]model.ProjectUnitArtifact, error) {
	var artifacts []model.ProjectUnitArtifact
	err := r.db.Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("version desc, created_at desc").Find(&artifacts).Error
	return artifacts, err
}

func (r *Repository) CreateProjectUnitArtifactActive(userID, projectID, unitID string, artifact *model.ProjectUnitArtifact) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		if err := tx.First(&model.ProjectUnit{}, "id = ? AND project_id = ?", unitID, projectID).Error; err != nil {
			return err
		}
		var maxVersion int
		if err := tx.Model(&model.ProjectUnitArtifact{}).
			Where("project_id = ? AND unit_id = ? AND type = ?", projectID, unitID, artifact.Type).
			Select("COALESCE(MAX(version), 0)").Scan(&maxVersion).Error; err != nil {
			return err
		}
		artifact.ProjectID = projectID
		artifact.UnitID = unitID
		artifact.Version = maxVersion + 1
		artifact.Selected = true
		artifact.Status = "ready"
		if err := tx.Model(&model.ProjectUnitArtifact{}).
			Where("project_id = ? AND unit_id = ? AND type = ?", projectID, unitID, artifact.Type).
			Update("selected", false).Error; err != nil {
			return err
		}
		return tx.Create(artifact).Error
	})
}
