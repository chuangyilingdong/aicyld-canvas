package repository

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) PluginPublication(pluginID string) (*model.PluginPublication, error) {
	var publication model.PluginPublication
	if err := r.db.First(&publication, "plugin_id = ?", strings.TrimSpace(pluginID)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &publication, nil
}

func (r *Repository) PluginPublications(status string) ([]model.PluginPublication, error) {
	query := r.db.Model(&model.PluginPublication{})
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}
	var publications []model.PluginPublication
	err := query.Order("updated_at desc, plugin_id asc").Find(&publications).Error
	return publications, err
}

func (r *Repository) SavePluginPublication(publication *model.PluginPublication) error {
	if publication == nil || strings.TrimSpace(publication.PluginID) == "" {
		return errors.New("plugin publication is empty")
	}
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "plugin_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"status", "current_release_id", "candidate_release_id", "updated_by", "submitted_at",
			"published_at", "disabled_at", "revoked_at", "revoke_reason", "updated_at",
		}),
	}).Create(publication).Error
}

func (r *Repository) CreatePluginRelease(release *model.PluginRelease) error {
	if release == nil || strings.TrimSpace(release.ID) == "" {
		return errors.New("plugin release is empty")
	}
	return r.db.Create(release).Error
}

// CommitPluginPublication creates the immutable release row and moves the
// plugin-level publication pointer in one transaction. A retry cannot leave a
// release row visible without its publication state, or vice versa.
func (r *Repository) CommitPluginPublication(publication *model.PluginPublication, release *model.PluginRelease) error {
	if publication == nil || strings.TrimSpace(publication.PluginID) == "" {
		return errors.New("plugin publication is empty")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		txRepo := r.WithTx(tx)
		if release != nil {
			if release.PluginID != publication.PluginID {
				return errors.New("plugin release does not belong to publication")
			}
			if err := txRepo.CreatePluginRelease(release); err != nil {
				return err
			}
		}
		return txRepo.SavePluginPublication(publication)
	})
}

func (r *Repository) PluginRelease(id string) (*model.PluginRelease, error) {
	var release model.PluginRelease
	if err := r.db.First(&release, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &release, nil
}

func (r *Repository) PluginReleaseByVersion(pluginID string, version string) (*model.PluginRelease, error) {
	var release model.PluginRelease
	if err := r.db.First(&release, "plugin_id = ? AND version = ?", strings.TrimSpace(pluginID), strings.TrimSpace(version)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &release, nil
}

func (r *Repository) PluginReleaseBySHA256(packageSHA256 string) (*model.PluginRelease, error) {
	var release model.PluginRelease
	if err := r.db.First(&release, "package_sha256 = ?", strings.TrimSpace(packageSHA256)).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &release, nil
}

func (r *Repository) PluginReleases(pluginID string) ([]model.PluginRelease, error) {
	var releases []model.PluginRelease
	err := r.db.Where("plugin_id = ?", strings.TrimSpace(pluginID)).Order("created_at desc, id desc").Find(&releases).Error
	return releases, err
}

func (r *Repository) SavePluginReleaseReview(releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error {
	return savePluginReleaseReview(r.db, releaseID, status, reviewerID, notes, reviewedAt)
}

// CommitPluginReleaseReview moves one release through review while updating the
// plugin-level candidate/publication state in the same transaction.
func (r *Repository) CommitPluginReleaseReview(publication *model.PluginPublication, releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error {
	if publication == nil || strings.TrimSpace(publication.PluginID) == "" {
		return errors.New("plugin publication is empty")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := savePluginReleaseReview(tx, releaseID, status, reviewerID, notes, reviewedAt); err != nil {
			return err
		}
		return r.WithTx(tx).SavePluginPublication(publication)
	})
}

func (r *Repository) CommitPluginReleasePublication(publication *model.PluginPublication, releaseID string, publishedBy string, publishedAt time.Time) error {
	if publication == nil || strings.TrimSpace(publication.PluginID) == "" {
		return errors.New("plugin publication is empty")
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.PluginRelease{}).Where("id = ?", strings.TrimSpace(releaseID)).Updates(map[string]any{
			"published_by": strings.TrimSpace(publishedBy),
			"published_at": publishedAt,
			"updated_at":   publishedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return r.WithTx(tx).SavePluginPublication(publication)
	})
}

func savePluginReleaseReview(db *gorm.DB, releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error {
	result := db.Model(&model.PluginRelease{}).Where("id = ?", strings.TrimSpace(releaseID)).Updates(map[string]any{
		"review_status": status,
		"reviewed_by":   strings.TrimSpace(reviewerID),
		"review_notes":  notes,
		"reviewed_at":   reviewedAt,
		"updated_at":    reviewedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
