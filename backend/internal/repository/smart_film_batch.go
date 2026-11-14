package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreateSmartFilmBatch(batch *model.SmartFilmBatch) error {
	return r.db.Create(batch).Error
}

func (r *Repository) SmartFilmBatchForUser(userID, batchID string) (*model.SmartFilmBatch, error) {
	var batch model.SmartFilmBatch
	if err := r.db.Where("id = ? AND user_id = ?", batchID, userID).First(&batch).Error; err != nil {
		return nil, err
	}
	return &batch, nil
}

func (r *Repository) UpdateSmartFilmBatch(userID, batchID string, expectedRevision int64, fields map[string]any) (*model.SmartFilmBatch, error) {
	fields = cloneSmartFilmBatchFields(fields)
	fields["revision"] = expectedRevision + 1
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.SmartFilmBatch{}).
		Where("id = ? AND user_id = ? AND revision = ?", batchID, userID, expectedRevision).
		Updates(fields)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := r.db.Model(&model.SmartFilmBatch{}).Where("id = ? AND user_id = ?", batchID, userID).Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, ErrProjectRevisionConflict
	}
	return r.SmartFilmBatchForUser(userID, batchID)
}

func cloneSmartFilmBatchFields(fields map[string]any) map[string]any {
	cloned := make(map[string]any, len(fields)+2)
	for key, value := range fields {
		cloned[key] = value
	}
	return cloned
}

func (r *Repository) SmartFilmProductionRunsForBatch(userID, batchID string) ([]model.SmartFilmProductionRun, error) {
	var runs []model.SmartFilmProductionRun
	err := r.db.Where("user_id = ? AND batch_id = ?", userID, batchID).Order("created_at asc, id asc").Find(&runs).Error
	return runs, err
}

func (r *Repository) SmartFilmProductionRunForUser(userID, batchID, runID string) (*model.SmartFilmProductionRun, error) {
	var run model.SmartFilmProductionRun
	if err := r.db.Where("id = ? AND user_id = ? AND batch_id = ?", runID, userID, batchID).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *Repository) UpdateSmartFilmProductionRunStage(userID, batchID, runID string, fields map[string]any) (*model.SmartFilmProductionRun, error) {
	fields = cloneSmartFilmBatchFields(fields)
	fields["revision"] = gorm.Expr("revision + 1")
	fields["updated_at"] = time.Now()
	result := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND user_id = ? AND batch_id = ?", runID, userID, batchID).
		Updates(fields)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	return r.SmartFilmProductionRunForUser(userID, batchID, runID)
}

func (r *Repository) SmartFilmAssetProductionRuns(limit int) ([]model.SmartFilmProductionRun, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var runs []model.SmartFilmProductionRun
	err := r.db.Where("status = ? AND asset_status IN ?", "ready", []string{"queued", "running"}).
		Order("updated_at asc, id asc").Limit(limit).Find(&runs).Error
	return runs, err
}

func (r *Repository) ClaimSmartFilmAssetProductionRun(runID, owner string, lease time.Duration) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND status = ? AND (asset_status = ? OR (asset_status = ? AND asset_task_id = '' AND (worker_lease_until IS NULL OR worker_lease_until <= ?)))",
			runID, "ready", "queued", "running", now).
		Updates(map[string]any{
			"asset_status": "running", "worker_lease_owner": owner,
			"worker_lease_until": now.Add(lease), "updated_at": now,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) RenewSmartFilmAssetProductionLease(runID, owner string, lease time.Duration) error {
	now := time.Now()
	return r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND asset_status = ?", runID, "running").
		Updates(map[string]any{"worker_lease_owner": owner, "worker_lease_until": now.Add(lease), "updated_at": now}).Error
}

// PrepareSmartFilmProductionRun creates the orchestration receipt before the
// confirmation transaction. A retry reuses the row and preserves any known
// resource snapshot, while a completed run remains replayable.
func (r *Repository) PrepareSmartFilmProductionRun(run *model.SmartFilmProductionRun) error {
	var existing model.SmartFilmProductionRun
	err := r.db.Where("idempotency_key = ?", run.IdempotencyKey).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(run).Error
	}
	if err != nil {
		return err
	}
	run.ID = existing.ID
	run.CreatedAt = existing.CreatedAt
	run.Attempts = existing.Attempts
	if run.ProjectID == "" {
		run.ProjectID = existing.ProjectID
	}
	if run.UnitID == "" {
		run.UnitID = existing.UnitID
	}
	if run.ResourceSnapshotJSON == "" {
		run.ResourceSnapshotJSON = existing.ResourceSnapshotJSON
	}
	if existing.Status == "ready" {
		*run = existing
		return nil
	}
	run.Status = "pending"
	run.CurrentStep = "pending"
	run.FailedStep = ""
	run.Error = ""
	run.RecoverableAction = ""
	run.UpdatedAt = time.Now()
	if err := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND user_id = ?", run.ID, run.UserID).
		Updates(map[string]any{
			"status": run.Status, "current_step": run.CurrentStep, "project_id": run.ProjectID,
			"unit_id": run.UnitID, "resource_snapshot_json": run.ResourceSnapshotJSON,
			"failed_step": "", "error": "", "recoverable_action": "", "updated_at": run.UpdatedAt,
		}).Error; err != nil {
		return err
	}
	return nil
}

func (r *Repository) UpdateSmartFilmProductionRun(run *model.SmartFilmProductionRun) error {
	return r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND user_id = ?", run.ID, run.UserID).
		Updates(map[string]any{
			"status": run.Status, "current_step": run.CurrentStep, "project_id": run.ProjectID,
			"unit_id": run.UnitID, "resource_snapshot_json": run.ResourceSnapshotJSON,
			"failed_step": run.FailedStep, "error": run.Error, "recoverable_action": run.RecoverableAction,
			"attempts": run.Attempts, "updated_at": run.UpdatedAt,
		}).Error
}

// RecordSmartFilmProductionRunFailure never replaces a completed receipt. A
// concurrent request that succeeded first must remain the source of truth.
func (r *Repository) RecordSmartFilmProductionRunFailure(userID, idempotencyKey, failedStep, message string) error {
	return r.db.Model(&model.SmartFilmProductionRun{}).
		Where("user_id = ? AND idempotency_key = ? AND status <> ?", userID, idempotencyKey, "ready").
		Updates(map[string]any{
			"status": "needs_attention", "current_step": failedStep, "failed_step": failedStep,
			"error": message, "recoverable_action": "retry_confirm", "updated_at": time.Now(),
		}).Error
}
