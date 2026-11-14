package repository

import (
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) ConfirmProjectAssetCandidateActive(userID string, candidate *model.ProjectAssetCandidate, asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation, link *model.ProjectAssetLink, createAsset bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if _, err := requireActiveProjectTx(tx, userID, candidate.ProjectID); err != nil {
			return err
		}
		if strings.TrimSpace(link.FolderID) != "" {
			if err := tx.First(&model.ProjectAssetFolder{}, "id = ? AND project_id = ?", link.FolderID, link.ProjectID).Error; err != nil {
				return err
			}
		}
		if createAsset {
			if err := tx.Create(asset).Error; err != nil {
				return err
			}
			if err := tx.Create(version).Error; err != nil {
				return err
			}
			if len(representations) > 0 {
				if err := tx.Create(&representations).Error; err != nil {
					return err
				}
			}
		} else if err := tx.First(&model.Asset{}, "id = ? AND user_id = ?", asset.ID, asset.UserID).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND asset_id = ?", link.ProjectID, link.AssetID).FirstOrCreate(link).Error; err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).
			Where("id = ? AND project_id = ? AND status = ?", candidate.ID, candidate.ProjectID, "pending_confirmation").
			Updates(map[string]any{"status": candidate.Status, "resolved_asset_id": candidate.ResolvedAssetID, "updated_at": candidate.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return bumpProjectRevisionTx(tx, candidate.ProjectID, candidate.UpdatedAt)
	})
}
