package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type SmartFilmScriptFilter struct {
	BatchID   string
	Status    string
	Title     string
	ProjectID string
	Page      int
	PageSize  int
}

func (r *Repository) SmartFilmScriptsForBatch(userID, batchID string) ([]model.SmartFilmScriptRecord, error) {
	var scripts []model.SmartFilmScriptRecord
	err := r.db.Where("user_id = ? AND batch_id = ?", userID, batchID).
		Order("position asc, created_at asc, id asc").Find(&scripts).Error
	return scripts, err
}

func (r *Repository) SmartFilmScriptForUser(userID, batchID, scriptID string) (*model.SmartFilmScriptRecord, error) {
	var script model.SmartFilmScriptRecord
	if err := r.db.Where("id = ? AND user_id = ? AND batch_id = ?", scriptID, userID, batchID).First(&script).Error; err != nil {
		return nil, err
	}
	return &script, nil
}

func (r *Repository) QuerySmartFilmScripts(userID string, filter SmartFilmScriptFilter) ([]model.SmartFilmScriptRecord, int64, error) {
	query := r.db.Model(&model.SmartFilmScriptRecord{}).Where("user_id = ?", userID)
	if batchID := strings.TrimSpace(filter.BatchID); batchID != "" {
		query = query.Where("batch_id = ?", batchID)
	}
	if status := strings.TrimSpace(filter.Status); status != "" {
		query = query.Where("status = ?", status)
	}
	if title := strings.TrimSpace(filter.Title); title != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(title)+"%")
	}
	if projectID := strings.TrimSpace(filter.ProjectID); projectID != "" {
		query = query.Where("project_id = ?", projectID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := filter.Page, filter.PageSize
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	var scripts []model.SmartFilmScriptRecord
	err := query.Order("updated_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&scripts).Error
	return scripts, total, err
}

func (r *Repository) UpsertSmartFilmScripts(userID, batchID string, scripts []model.SmartFilmScriptRecord) error {
	return r.Transaction(func(txRepo *Repository) error {
		for index := range scripts {
			scripts[index].UserID = userID
			scripts[index].BatchID = batchID
			scripts[index].Position = index
			if err := txRepo.upsertSmartFilmScript(&scripts[index], 0); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) UpdateSmartFilmScript(userID, batchID string, script model.SmartFilmScriptRecord, expectedRevision int64) error {
	return r.Transaction(func(txRepo *Repository) error {
		if err := txRepo.upsertSmartFilmScript(&script, expectedRevision); err != nil {
			return err
		}
		return nil
	})
}

func (r *Repository) upsertSmartFilmScript(script *model.SmartFilmScriptRecord, expectedRevision int64) error {
	var existing model.SmartFilmScriptRecord
	err := r.db.Where("id = ? AND user_id = ? AND batch_id = ?", script.ID, script.UserID, script.BatchID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if expectedRevision > 0 {
			return ErrProjectRevisionConflict
		}
		now := time.Now()
		if script.Revision <= 0 {
			script.Revision = 1
		}
		if script.CreatedAt.IsZero() {
			script.CreatedAt = now
		}
		script.UpdatedAt = now
		if err := r.db.Create(script).Error; err != nil {
			return err
		}
		return r.createSmartFilmScriptRevision(*script)
	}
	if err != nil {
		return err
	}
	if expectedRevision > 0 && existing.Revision != expectedRevision {
		return ErrProjectRevisionConflict
	}
	changed := existing.Title != script.Title || existing.Content != script.Content || existing.Status != script.Status ||
		existing.ProjectID != script.ProjectID || existing.UnitID != script.UnitID || existing.TaskID != script.TaskID || existing.Error != script.Error
	script.CreatedAt = existing.CreatedAt
	script.Revision = existing.Revision
	if changed {
		script.Revision++
	}
	script.UpdatedAt = time.Now()
	if err := r.db.Model(&model.SmartFilmScriptRecord{}).
		Where("id = ? AND user_id = ? AND batch_id = ?", script.ID, script.UserID, script.BatchID).
		Updates(map[string]any{
			"position": script.Position, "title": script.Title, "content": script.Content, "status": script.Status,
			"project_id": script.ProjectID, "unit_id": script.UnitID, "task_id": script.TaskID, "error": script.Error,
			"revision": script.Revision, "updated_at": script.UpdatedAt,
		}).Error; err != nil {
		return err
	}
	if changed {
		return r.createSmartFilmScriptRevision(*script)
	}
	return nil
}

func (r *Repository) createSmartFilmScriptRevision(script model.SmartFilmScriptRecord) error {
	revision := model.SmartFilmScriptRevision{
		ID: kernel.NewID(), ScriptID: script.ID, UserID: script.UserID, BatchID: script.BatchID,
		Version: script.Revision, Title: script.Title, Content: script.Content, Status: script.Status,
		ProjectID: script.ProjectID, UnitID: script.UnitID, TaskID: script.TaskID, Error: script.Error,
		CreatedAt: script.UpdatedAt,
	}
	return r.db.Create(&revision).Error
}

func (r *Repository) DeleteSmartFilmScript(userID, batchID, scriptID string) error {
	return r.Transaction(func(txRepo *Repository) error {
		if err := txRepo.db.Where("script_id = ? AND user_id = ? AND batch_id = ?", scriptID, userID, batchID).Delete(&model.SmartFilmScriptRevision{}).Error; err != nil {
			return err
		}
		result := txRepo.db.Where("id = ? AND user_id = ? AND batch_id = ?", scriptID, userID, batchID).Delete(&model.SmartFilmScriptRecord{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) DeleteSmartFilmScriptsNotIn(userID, batchID string, scriptIDs []string) error {
	query := r.db.Where("user_id = ? AND batch_id = ?", userID, batchID)
	if len(scriptIDs) > 0 {
		query = query.Where("id NOT IN ?", scriptIDs)
	}
	var removed []model.SmartFilmScriptRecord
	if err := query.Find(&removed).Error; err != nil {
		return err
	}
	for _, script := range removed {
		if err := r.DeleteSmartFilmScript(userID, batchID, script.ID); err != nil {
			return fmt.Errorf("删除剧本 %s: %w", script.ID, err)
		}
	}
	return nil
}
