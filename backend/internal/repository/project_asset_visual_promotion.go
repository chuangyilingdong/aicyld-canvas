package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) PromoteProjectAssetVisualActive(userID, projectID string, asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation, expectedRevision int64, updatedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, projectID); err != nil {
			return err
		}
		var linked int64
		if err := tx.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", projectID, asset.ID).Count(&linked).Error; err != nil {
			return err
		}
		if linked == 0 {
			return gorm.ErrRecordNotFound
		}
		var maxVersion int
		if err := tx.Model(&model.AssetVersion{}).Where("asset_id = ?", asset.ID).Select("COALESCE(MAX(version), 0)").Scan(&maxVersion).Error; err != nil {
			return err
		}
		version.Version = maxVersion + 1
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, userID).Updates(map[string]any{
			"kind": asset.Kind, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID,
			"payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := invalidateShotsReferencingAssetTx(tx, projectID, asset.ID, updatedAt); err != nil {
			return err
		}
		return bumpProjectRevisionCASTx(tx, projectID, expectedRevision, updatedAt)
	})
}
