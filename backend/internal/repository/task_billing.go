package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var ErrSmartFilmBudgetExceeded = errors.New("批次预算不足")

// TaskBillingStatusCount groups unfinished or settled billing states for
// operational visibility.
type TaskBillingStatusCount struct {
	Status string
	Count  int64
}

// UpdateTaskBilling persists only AICYLD-owned billing metadata. The shared
// Task model marks these columns read-only so normal GORM writes cannot mutate
// them accidentally.
func (r *Repository) UpdateTaskBilling(task *model.Task) error {
	if task == nil || task.UserID == "" || task.ID == "" {
		return nil
	}
	return withImmediateTransaction(r.db, func(tx *gorm.DB) error {
		var current model.Task
		if err := tx.Select(
			"id", "user_id", "project_id", "input_json", "billing_hold_id", "billing_status",
			"billing_points", "billing_reserved_points", "billing_settled_points", "billing_refunded_points",
		).Where("id = ? AND user_id = ?", task.ID, task.UserID).First(&current).Error; err != nil {
			return err
		}
		return applyTaskBillingTx(tx, &current, task)
	})
}

// StaleReservedTasks returns billing transitions that outlived their local task
// lifecycle. Besides reserved it retries refund_pending and pending_reconcile so
// transient billing failures do not strand a task forever.
func (r *Repository) StaleReservedTasks(cutoff time.Time, limit int) ([]model.Task, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var tasks []model.Task
	err := r.db.Where("billing_hold_id <> '' AND (billing_status IN ? OR (billing_status = ? AND updated_at < ?))", []string{"refund_pending", "pending_reconcile"}, "reserved", cutoff).
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
	if task.BillingHoldID == "" && task.BillingStatus == "" && task.BillingPoints == 0 &&
		task.BillingReservedPoints == 0 && task.BillingSettledPoints == 0 && task.BillingRefundedPoints == 0 {
		return nil
	}
	return applyTaskBillingTx(tx, nil, task)
}

func applyTaskBillingTx(tx *gorm.DB, current, next *model.Task) error {
	if next == nil || next.ID == "" {
		return nil
	}
	batchID, err := smartFilmTaskBatchIDTx(tx, next)
	if err != nil {
		return err
	}
	if batchID != "" && next.BillingStatus == "reserved" && (current == nil || current.BillingHoldID != next.BillingHoldID) {
		var batch model.SmartFilmBatch
		if err := tx.Select("status").Where("id = ? AND user_id = ?", batchID, next.UserID).First(&batch).Error; err != nil {
			return err
		}
		if batch.Status == "archived" {
			return ErrSmartFilmBatchArchived
		}
	}
	oldPoints := effectiveBillingPoints(current)
	newPoints := effectiveBillingPoints(next)
	if batchID != "" && oldPoints != newPoints {
		delta := newPoints - oldPoints
		if delta > 0 {
			if next.BillingStatus == "settled" {
				// Actual upstream charges must be recorded even when they exceed the estimate.
				if err := tx.Exec(`UPDATE smart_film_batches
					SET budget_used_points = budget_used_points + ?
					WHERE id = ? AND user_id = ?`, delta, batchID, next.UserID).Error; err != nil {
					return err
				}
			} else {
				result := tx.Exec(`UPDATE smart_film_batches
					SET budget_used_points = budget_used_points + ?
					WHERE id = ? AND user_id = ?
						AND (budget_points = 0 OR budget_used_points + ? <= budget_points)`,
					delta, batchID, next.UserID, delta)
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					var batch model.SmartFilmBatch
					if findErr := tx.Select("budget_points", "budget_used_points").
						Where("id = ? AND user_id = ?", batchID, next.UserID).First(&batch).Error; findErr == nil {
						return fmt.Errorf("%w：预算 %d 积分，已占用 %d，本次需要新增 %d",
							ErrSmartFilmBudgetExceeded, batch.BudgetPoints, batch.BudgetUsedPoints, delta)
					}
					return ErrSmartFilmBudgetExceeded
				}
			}
		} else {
			if err := tx.Exec(`UPDATE smart_film_batches
				SET budget_used_points = CASE
					WHEN budget_used_points + ? < 0 THEN 0
					ELSE budget_used_points + ?
				END
				WHERE id = ? AND user_id = ?`, delta, delta, batchID, next.UserID).Error; err != nil {
				return err
			}
		}
	}
	return tx.Exec(
		`UPDATE tasks SET billing_hold_id = ?, billing_status = ?, billing_points = ?,
			billing_reserved_points = ?, billing_settled_points = ?, billing_refunded_points = ?,
			updated_at = ?
		WHERE id = ? AND user_id = ?`,
		next.BillingHoldID, next.BillingStatus, next.BillingPoints,
		next.BillingReservedPoints, next.BillingSettledPoints, next.BillingRefundedPoints,
		time.Now(), next.ID, next.UserID,
	).Error
}

func effectiveBillingPoints(task *model.Task) int {
	if task == nil || task.BillingStatus == "" || task.BillingStatus == "free" || task.BillingStatus == "refunded" {
		return 0
	}
	if task.BillingStatus == "settled" {
		if task.BillingSettledPoints > 0 {
			return task.BillingSettledPoints
		}
		return task.BillingPoints
	}
	if task.BillingReservedPoints > 0 {
		return task.BillingReservedPoints
	}
	if task.BillingPoints > 0 {
		return task.BillingPoints
	}
	return 0
}

func smartFilmTaskBatchIDTx(tx *gorm.DB, task *model.Task) (string, error) {
	if task == nil {
		return "", nil
	}
	var input struct {
		Metadata struct {
			BatchID         string `json:"batchId"`
			DomainProjectID string `json:"domainProjectId"`
			ProjectID       string `json:"projectId"`
		} `json:"metadata"`
	}
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	for _, candidate := range []string{input.Metadata.DomainProjectID, input.Metadata.ProjectID, task.ProjectID} {
		projectID := strings.TrimSpace(candidate)
		if projectID == "" {
			continue
		}
		var project model.Project
		err := tx.Select("batch_id").Where("id = ? AND user_id = ?", projectID, task.UserID).First(&project).Error
		if err == nil && strings.TrimSpace(project.BatchID) != "" {
			return strings.TrimSpace(project.BatchID), nil
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
	}
	return strings.TrimSpace(input.Metadata.BatchID), nil
}

func (r *Repository) SmartFilmBatchForTask(task *model.Task) (*model.SmartFilmBatch, error) {
	id, err := smartFilmTaskBatchIDTx(r.db, task)
	if err != nil || id == "" {
		return nil, err
	}
	return r.SmartFilmBatchForUser(task.UserID, id)
}

func requireSmartFilmTaskBatchActiveTx(tx *gorm.DB, task *model.Task) error {
	id, err := smartFilmTaskBatchIDTx(tx, task)
	if err != nil || id == "" {
		return err
	}
	var batch model.SmartFilmBatch
	if err := tx.Select("status").Where("id = ? AND user_id = ?", id, task.UserID).First(&batch).Error; err != nil {
		return err
	}
	if batch.Status == "archived" {
		return ErrSmartFilmBatchArchived
	}
	return nil
}
