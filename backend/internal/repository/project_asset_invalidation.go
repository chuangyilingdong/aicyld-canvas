package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// invalidateShotsReferencingAssetTx invalidates only shots that reference the
// changed asset. A new asset version or character version must not leave an
// old confirmed prompt eligible for video generation.
func invalidateShotsReferencingAssetTx(tx *gorm.DB, projectID, assetID string, updatedAt time.Time) error {
	var shots []model.Shot
	if err := tx.Table("shots").Select("DISTINCT shots.*").
		Joins("JOIN shot_asset_references ON shot_asset_references.shot_id = shots.id").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Where("shots.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Find(&shots).Error; err != nil {
		return err
	}
	for _, shot := range shots {
		if err := tx.Model(&model.Shot{}).Where("id = ? AND project_id = ?", shot.ID, projectID).
			Updates(map[string]any{"status": "draft", "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND status NOT IN ?", shot.ID, []string{"failed", "stale"}).
			Updates(map[string]any{"status": "stale", "selected": false, "updated_at": updatedAt}).Error; err != nil {
			return err
		}
		if err := invalidateUnitWorkflowTx(tx, projectID, shot.UnitID, "storyboard", updatedAt); err != nil {
			return err
		}
	}
	return nil
}
