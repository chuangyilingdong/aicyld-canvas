package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// TaskBillingStatusCount groups unfinished or settled billing states for
// operational visibility.
type TaskBillingStatusCount struct {
	Status string
	Count  int64
}

// UpdateTaskBilling persists only AICYLD-owned billing metadata. The shared
// Task model marks these columns read-only so normal GORM writes cannot mutate
// them accidentally.
func (r *Repository) UpdateTaskBilling(userID, taskID, holdID, status string, points int) error {
	if userID == "" || taskID == "" {
		return nil
	}
	if holdID != "" {
		return r.db.Exec(
			"UPDATE tasks SET billing_hold_id = ?, billing_status = ?, billing_points = ?, updated_at = ? WHERE id = ? AND user_id = ?",
			holdID, status, points, time.Now(), taskID, userID,
		).Error
	}
	return r.db.Exec(
		"UPDATE tasks SET billing_status = ?, billing_points = ?, updated_at = ? WHERE id = ? AND user_id = ?",
		status, points, time.Now(), taskID, userID,
	).Error
}

// StaleReservedTasks returns billing transitions that outlived their local task
// lifecycle. Besides reserved it retries refund_pending and pending_reconcile so
// transient billing failures do not strand a task forever.
func (r *Repository) StaleReservedTasks(cutoff time.Time, limit int) ([]model.Task, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var tasks []model.Task
	err := r.db.Where("billing_hold_id <> '' AND billing_status IN ? AND updated_at < ?", []string{"reserved", "refund_pending", "pending_reconcile"}, cutoff).
		Order("updated_at asc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) TaskBillingStatusCounts() ([]TaskBillingStatusCount, error) {
	var counts []TaskBillingStatusCount
	err := r.db.Model(&model.Task{}).
		Select("billing_status as status, count(*) as count").
		Where("billing_hold_id <> '' AND billing_status <> ''").
		Group("billing_status").
		Order("billing_status asc").
		Scan(&counts).Error
	return counts, err
}

// FailStaleQueuedReservedTask closes a queued task that never acquired a worker
// lease. The status guard prevents racing a worker that just claimed it.
func (r *Repository) FailStaleQueuedReservedTask(taskID string, cutoff time.Time, errorMessage string) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND billing_status = ? AND billing_hold_id <> '' AND lease_owner = '' AND updated_at < ?", taskID, model.TaskStatusQueued, "reserved", cutoff).
		Updates(map[string]any{
			"status":       model.TaskStatusFailed,
			"stage":        "预扣对账",
			"progress":     100,
			"error":        errorMessage,
			"completed_at": now,
			"updated_at":   now,
		})
	return result.RowsAffected == 1, result.Error
}

// FailStaleRunningReservedTask only closes pre-dispatch tasks whose worker lease
// has expired. Once a provider request exists, refunding here could hide a real
// upstream job, so those tasks remain for the normal recovery path.
func (r *Repository) FailStaleRunningReservedTask(taskID string, cutoff time.Time, errorMessage string) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.Task{}).
		Where("id = ? AND status = ? AND billing_status = ? AND billing_hold_id <> '' AND updated_at < ? AND provider_request_id = '' AND (lease_expires_at IS NULL OR lease_expires_at < ?)", taskID, model.TaskStatusRunning, "reserved", cutoff, now).
		Updates(map[string]any{
			"status":       model.TaskStatusFailed,
			"stage":        "预扣对账",
			"progress":     100,
			"error":        errorMessage,
			"completed_at": now,
			"updated_at":   now,
			"lease_owner":  "",
		})
	return result.RowsAffected == 1, result.Error
}

func updateTaskBillingTx(tx *gorm.DB, task *model.Task) error {
	if task == nil || task.ID == "" {
		return nil
	}
	if task.BillingHoldID == "" && task.BillingStatus == "" && task.BillingPoints == 0 {
		return nil
	}
	return tx.Exec(
		"UPDATE tasks SET billing_hold_id = ?, billing_status = ?, billing_points = ? WHERE id = ?",
		task.BillingHoldID, task.BillingStatus, task.BillingPoints, task.ID,
	).Error
}
