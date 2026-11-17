package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// invalidateProjectUnitArtifactsTx marks whole-film outputs stale whenever an
// input shot changes. Shot artifacts already carry revision IDs; unit-level
// outputs such as smart films need an explicit invalidation step.
func invalidateProjectUnitArtifactsTx(tx *gorm.DB, projectID, unitID string, updatedAt time.Time) error {
	if !tx.Migrator().HasTable(&model.ProjectUnitArtifact{}) {
		return nil
	}
	return tx.Model(&model.ProjectUnitArtifact{}).
		Where("project_id = ? AND unit_id = ? AND status NOT IN ?", projectID, unitID, []string{"failed", "stale"}).
		Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error
}
