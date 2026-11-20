package repository

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var ErrSmartFilmBudgetBelowUsed = errors.New("批次预算不能低于已占用积分")
var ErrSmartFilmBatchActiveTasks = errors.New("批次仍有生成任务正在运行")
var ErrSmartFilmBatchArchived = errors.New("批次已归档，只能查看历史记录和账单")

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

func (r *Repository) SmartFilmBatchesForUser(userID, status, search string, page, pageSize int) ([]model.SmartFilmBatch, int64, error) {
	query := r.db.Model(&model.SmartFilmBatch{}).Where("user_id = ?", userID)
	if strings.TrimSpace(status) != "" {
		query = query.Where("status = ?", status)
	} else {
		query = query.Where("status <> ?", "archived")
	}
	if search = strings.TrimSpace(search); search != "" {
		pattern := "%" + search + "%"
		query = query.Where("(title LIKE ? COLLATE NOCASE OR source_text LIKE ? COLLATE NOCASE)", pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var batches []model.SmartFilmBatch
	err := query.Order("updated_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&batches).Error
	return batches, total, err
}

func (r *Repository) DeleteSmartFilmBatch(userID, batchID string) error {
	return withImmediateTransaction(r.db, func(tx *gorm.DB) error {
		var batch model.SmartFilmBatch
		if err := tx.Where("id = ? AND user_id = ?", batchID, userID).First(&batch).Error; err != nil {
			return err
		}
		var activeTasks int64
		if err := smartFilmBatchTaskScope(tx, userID, batchID).
			Where("tasks.status IN ?", []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
			Count(&activeTasks).Error; err != nil {
			return err
		}
		var activeRuns int64
		if err := tx.Model(&model.SmartFilmProductionRun{}).
			Where("user_id = ? AND batch_id = ? AND (asset_status IN ? OR storyboard_status IN ?)", userID, batchID,
				[]string{"queued", "running"}, []string{"queued", "running"}).Count(&activeRuns).Error; err != nil {
			return err
		}
		if activeTasks > 0 || activeRuns > 0 {
			return ErrSmartFilmBatchActiveTasks
		}
		var billedTasks int64
		if err := smartFilmBatchTaskScope(tx, userID, batchID).
			Where("COALESCE(billing_hold_id, '') <> '' OR billing_points > 0 OR billing_reserved_points > 0 OR billing_settled_points > 0 OR billing_refunded_points > 0").
			Count(&billedTasks).Error; err != nil {
			return err
		}
		if billedTasks > 0 || batch.BudgetUsedPoints > 0 {
			return tx.Model(&model.SmartFilmBatch{}).Where("id = ? AND user_id = ?", batchID, userID).
				Updates(map[string]any{"status": "archived", "paused": true, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
		}
		var scripts []model.SmartFilmScriptRecord
		if err := tx.Where("user_id = ? AND batch_id = ?", userID, batchID).Find(&scripts).Error; err != nil {
			return err
		}
		projectIDs := make([]string, 0, len(scripts))
		for _, script := range scripts {
			if strings.TrimSpace(script.ProjectID) != "" {
				projectIDs = append(projectIDs, script.ProjectID)
			}
		}
		if len(projectIDs) > 0 {
			if err := tx.Model(&model.Project{}).Where("user_id = ? AND id IN ?", userID, projectIDs).Updates(map[string]any{
				"batch_id": "", "source_run_id": "", "source_script_id": "",
			}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("user_id = ? AND batch_id = ?", userID, batchID).Delete(&model.SmartFilmProductionRun{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND batch_id = ?", userID, batchID).Delete(&model.SmartFilmScriptRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND batch_id = ?", userID, batchID).Delete(&model.SmartFilmScriptRecord{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ? AND user_id = ?", batchID, userID).Delete(&model.SmartFilmBatch{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) UpdateSmartFilmBatch(userID, batchID string, expectedRevision int64, fields map[string]any) (*model.SmartFilmBatch, error) {
	fields = cloneSmartFilmBatchFields(fields)
	fields["revision"] = expectedRevision + 1
	fields["updated_at"] = time.Now()
	query := r.db.Model(&model.SmartFilmBatch{}).Where("id = ? AND user_id = ? AND revision = ? AND status <> ?", batchID, userID, expectedRevision, "archived")
	if budgetValue, hasBudget := fields["budget_points"]; hasBudget {
		if budgetPoints, ok := budgetValue.(int); ok && budgetPoints > 0 {
			query = query.Where("budget_used_points <= ?", budgetPoints)
		}
	}
	result := query.Updates(fields)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		var current model.SmartFilmBatch
		if err := r.db.Select("revision", "status", "budget_used_points").Where("id = ? AND user_id = ?", batchID, userID).First(&current).Error; err != nil {
			return nil, err
		}
		if current.Status == "archived" {
			return nil, ErrSmartFilmBatchArchived
		}
		if current.Revision != expectedRevision {
			return nil, ErrProjectRevisionConflict
		}
		if budgetValue, hasBudget := fields["budget_points"]; hasBudget {
			if budgetPoints, ok := budgetValue.(int); ok && budgetPoints > 0 && budgetPoints < current.BudgetUsedPoints {
				return nil, ErrSmartFilmBudgetBelowUsed
			}
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
	err := r.db.Where("user_id = ? AND batch_id = ? AND status <> ?", userID, batchID, "archived").Order("created_at asc, id asc").Find(&runs).Error
	return runs, err
}

func (r *Repository) ArchiveUnprojectedSmartFilmProductionRunsForScript(userID, batchID, scriptID, reason string) (int64, error) {
	now := time.Now()
	result := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("user_id = ? AND batch_id = ? AND script_id = ? AND status <> ? AND (project_id = '' OR project_id IS NULL)", userID, batchID, scriptID, "archived").
		Updates(map[string]any{
			"status": "archived", "current_step": "archived", "archive_reason": reason,
			"archived_at": now, "worker_lease_owner": "", "worker_lease_until": nil,
			"revision": gorm.Expr("revision + 1"), "updated_at": now,
		})
	return result.RowsAffected, result.Error
}

func (r *Repository) DeleteOrphanSmartFilmProductionRunsForScript(userID, batchID, scriptID string) (int64, error) {
	result := r.db.Where(
		"user_id = ? AND batch_id = ? AND script_id = ? AND (project_id = '' OR project_id IS NULL OR NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = smart_film_production_runs.project_id AND p.user_id = smart_film_production_runs.user_id))",
		userID, batchID, scriptID,
	).Delete(&model.SmartFilmProductionRun{})
	return result.RowsAffected, result.Error
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
	err := r.db.Model(&model.SmartFilmProductionRun{}).
		Select("smart_film_production_runs.*").
		Joins("JOIN smart_film_batches ON smart_film_batches.id = smart_film_production_runs.batch_id AND smart_film_batches.user_id = smart_film_production_runs.user_id").
		Where("smart_film_production_runs.status = ? AND smart_film_production_runs.asset_status IN ?", "ready", []string{"queued", "running"}).
		Where("(smart_film_production_runs.control_status = ? OR smart_film_production_runs.control_status = '') AND smart_film_batches.paused = ?", "active", false).
		Order("smart_film_production_runs.updated_at asc, smart_film_production_runs.id asc").Limit(limit).Find(&runs).Error
	return runs, err
}

func (r *Repository) SmartFilmStoryboardProductionRuns(limit int) ([]model.SmartFilmProductionRun, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	var runs []model.SmartFilmProductionRun
	err := r.db.Model(&model.SmartFilmProductionRun{}).
		Select("smart_film_production_runs.*").
		Joins("JOIN smart_film_batches ON smart_film_batches.id = smart_film_production_runs.batch_id AND smart_film_batches.user_id = smart_film_production_runs.user_id").
		Where("smart_film_production_runs.status = ? AND smart_film_production_runs.storyboard_status IN ?", "ready", []string{"queued", "running"}).
		Where("smart_film_production_runs.asset_status IN ?", []string{"confirmed", "ready"}).
		Where("(smart_film_production_runs.control_status = ? OR smart_film_production_runs.control_status = '') AND smart_film_batches.paused = ?", "active", false).
		Order("smart_film_production_runs.updated_at asc, smart_film_production_runs.id asc").Limit(limit).Find(&runs).Error
	return runs, err
}

func (r *Repository) ClaimSmartFilmAssetProductionRun(runID, owner string, lease time.Duration) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND status = ? AND (asset_status = ? OR (asset_status = ? AND asset_task_id = '' AND (worker_lease_until IS NULL OR worker_lease_until <= ?)))",
			runID, "ready", "queued", "running", now).
		Where("(control_status = ? OR control_status = '')", "active").
		Where("EXISTS (SELECT 1 FROM smart_film_batches b WHERE b.id = smart_film_production_runs.batch_id AND b.paused = ?)", false).
		Updates(map[string]any{
			"asset_status": "running", "worker_lease_owner": owner,
			"worker_lease_until": now.Add(lease), "updated_at": now,
		})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *Repository) ClaimSmartFilmStoryboardProductionRun(runID, owner string, lease time.Duration) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND status = ? AND (storyboard_status = ? OR (storyboard_status = ? AND storyboard_task_id = '' AND (worker_lease_until IS NULL OR worker_lease_until <= ?)))",
			runID, "ready", "queued", "running", now).
		Where("asset_status IN ?", []string{"confirmed", "ready"}).
		Where("(control_status = ? OR control_status = '')", "active").
		Where("EXISTS (SELECT 1 FROM smart_film_batches b WHERE b.id = smart_film_production_runs.batch_id AND b.paused = ?)", false).
		Updates(map[string]any{
			"storyboard_status": "running", "worker_lease_owner": owner,
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

func (r *Repository) RenewSmartFilmStoryboardProductionLease(runID, owner string, lease time.Duration) error {
	now := time.Now()
	return r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND storyboard_status = ?", runID, "running").
		Updates(map[string]any{"worker_lease_owner": owner, "worker_lease_until": now.Add(lease), "updated_at": now}).Error
}

func (r *Repository) SetSmartFilmBatchPaused(userID, batchID string, paused bool) (*model.SmartFilmBatch, error) {
	result := r.db.Model(&model.SmartFilmBatch{}).
		Where("id = ? AND user_id = ? AND status <> 'archived'", batchID, userID).
		Updates(map[string]any{"paused": paused, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	return r.SmartFilmBatchForUser(userID, batchID)
}

func (r *Repository) SetSmartFilmBatchBudget(userID, batchID string, budgetPoints int) (*model.SmartFilmBatch, error) {
	result := r.db.Model(&model.SmartFilmBatch{}).
		Where("id = ? AND user_id = ? AND status <> 'archived' AND (? = 0 OR budget_used_points <= ?)", batchID, userID, budgetPoints, budgetPoints).
		Updates(map[string]any{"budget_points": budgetPoints, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		var batch model.SmartFilmBatch
		if err := r.db.Select("status").Where("id = ? AND user_id = ?", batchID, userID).First(&batch).Error; err != nil {
			return nil, err
		}
		if batch.Status == "archived" {
			return nil, ErrSmartFilmBatchArchived
		}
		return nil, ErrSmartFilmBudgetBelowUsed
	}
	return r.SmartFilmBatchForUser(userID, batchID)
}

func (r *Repository) SmartFilmBatchCommittedPoints(userID, batchID string) (int, error) {
	var batch model.SmartFilmBatch
	err := r.db.Select("budget_used_points").
		Where("id = ? AND user_id = ?", batchID, userID).
		First(&batch).Error
	return batch.BudgetUsedPoints, err
}

type SmartFilmBatchBillingTotals struct {
	ReservedPoints int
	SettledPoints  int
	RefundedPoints int
	PendingPoints  int
	UnbilledTasks  int
	ActiveTasks    int
	TerminalTasks  int
}

type SmartFilmBatchTaskWorkCount struct {
	ProjectID string
	Stage     string
	ShotID    string
	TaskCount int
}

func smartFilmBatchTaskScope(db *gorm.DB, userID, batchID string) *gorm.DB {
	input := "CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json ELSE '{}' END"
	return db.Table("tasks").Where("tasks.user_id = ?", userID).Where(
		"EXISTS (SELECT 1 FROM projects WHERE projects.id IN (tasks.project_id, json_extract("+input+", '$.metadata.domainProjectId'), json_extract("+input+", '$.metadata.projectId')) AND projects.user_id = ? AND projects.batch_id = ?) OR json_extract("+input+", '$.metadata.batchId') = ?",
		userID, batchID, batchID,
	)
}

func (r *Repository) SmartFilmBatchBillingTotals(userID, batchID string) (SmartFilmBatchBillingTotals, error) {
	var totals SmartFilmBatchBillingTotals
	query := smartFilmBatchTaskScope(r.db, userID, batchID)
	err := query.Select(`
		COALESCE(SUM(CASE WHEN billing_status IN ('reserved','settling','pending_reconcile','refund_pending') THEN CASE WHEN billing_reserved_points > 0 THEN billing_reserved_points ELSE billing_points END ELSE 0 END), 0) AS reserved_points,
		COALESCE(SUM(CASE WHEN billing_status = 'settled' THEN CASE WHEN billing_settled_points > 0 THEN billing_settled_points ELSE billing_points END ELSE 0 END), 0) AS settled_points,
		COALESCE(SUM(CASE WHEN billing_refunded_points > 0 THEN billing_refunded_points WHEN billing_status = 'refunded' THEN CASE WHEN billing_reserved_points > 0 THEN billing_reserved_points ELSE billing_points END ELSE 0 END), 0) AS refunded_points,
		COALESCE(SUM(CASE WHEN status IN ? AND billing_status IN ('reserved','settling','pending_reconcile','refund_pending') THEN CASE WHEN billing_reserved_points > 0 THEN billing_reserved_points ELSE billing_points END ELSE 0 END), 0) AS pending_points,
		COALESCE(SUM(CASE WHEN billing_status IS NULL OR billing_status = '' OR billing_status = 'free' THEN 1 ELSE 0 END), 0) AS unbilled_tasks,
		COALESCE(SUM(CASE WHEN status IN ? THEN 1 ELSE 0 END), 0) AS active_tasks,
		COALESCE(SUM(CASE WHEN status IN ? THEN 1 ELSE 0 END), 0) AS terminal_tasks`,
		[]model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning},
		[]model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning},
		[]model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled}).Scan(&totals).Error
	return totals, err
}

func (r *Repository) SmartFilmBatchTasksPage(userID, batchID string, page, pageSize int) ([]model.Task, int64, error) {
	query := smartFilmBatchTaskScope(r.db, userID, batchID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []model.Task
	err := query.
		Select(
			"id", "user_id", "project_id", "type", "status",
			"operation", "provider", "model", "provider_request_id", "CASE WHEN json_valid(input_json) THEN json_object('metadata', json_extract(input_json, '$.metadata')) ELSE '{}' END AS input_json",
			"error", "started_at", "completed_at", "created_at",
			"billing_hold_id", "billing_status", "billing_points",
			"billing_reserved_points", "billing_settled_points", "billing_refunded_points",
		).
		Order("created_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&tasks).Error
	return tasks, total, err
}

func (r *Repository) SmartFilmBatchTaskWorkCounts(userID, batchID string) ([]SmartFilmBatchTaskWorkCount, error) {
	var rows []SmartFilmBatchTaskWorkCount
	query := smartFilmBatchTaskScope(r.db, userID, batchID)
	input := "CASE WHEN json_valid(tasks.input_json) THEN tasks.input_json ELSE '{}' END"
	source := "json_extract(" + input + ", '$.metadata.source')"
	purpose := "json_extract(" + input + ", '$.metadata.audioPurpose')"
	stage := `CASE
		WHEN ` + source + ` = 'smart-film-batch-script' THEN 'script'
		WHEN ` + source + ` = 'smart-film-batch-worker' AND tasks.operation = 'chapter_character_breakdown' THEN 'assets'
		WHEN ` + source + ` = 'smart-film-batch-worker' AND tasks.operation = 'storyboard' THEN 'storyboard'
		WHEN ` + source + ` = 'smart-film-narration' OR ` + purpose + ` = 'voice' THEN 'narration'
		WHEN ` + source + ` = 'smart-film-bgm' OR ` + purpose + ` = 'music' THEN 'bgm'
		WHEN ` + source + ` = 'smart-film-whole-video' THEN 'whole_video'
		WHEN ` + source + ` = 'short-drama-workflow' AND lower(tasks.type) LIKE '%image%' THEN 'image'
		WHEN ` + source + ` = 'short-drama-workflow' AND lower(tasks.type) LIKE '%video%' THEN 'video'
		ELSE '' END`
	project := "COALESCE(NULLIF(json_extract(" + input + ", '$.metadata.domainProjectId'), ''), NULLIF(json_extract(" + input + ", '$.metadata.projectId'), ''), tasks.project_id)"
	shot := "COALESCE(json_extract(" + input + ", '$.metadata.shotId'), '')"
	revision := "COALESCE(json_extract(" + input + ", '$.metadata.shotRevisionId'), '')"
	err := query.Select(project+" AS project_id, "+stage+" AS stage, "+shot+" AS shot_id, COUNT(*) AS task_count").
		Where("tasks.status IN ?", []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusSucceeded}).
		Where("("+source+" IN ? OR "+purpose+" IN ?)", []string{"short-drama-workflow", "smart-film-batch-worker", "smart-film-batch-script", "smart-film-whole-video", "smart-film-narration", "smart-film-bgm"}, []string{"voice", "music"}).
		Where("NOT EXISTS (SELECT 1 FROM shots s WHERE s.id = " + shot + " AND " + revision + " <> '' AND s.current_revision_id <> " + revision + ")").
		Where("tasks.status <> 'succeeded' OR (NOT EXISTS (SELECT 1 FROM shot_artifacts a WHERE a.task_id = tasks.id AND a.status = 'stale') AND NOT EXISTS (SELECT 1 FROM project_unit_artifacts a WHERE a.task_id = tasks.id AND a.status = 'stale'))").
		Group(project + ", " + stage + ", " + shot).Scan(&rows).Error
	return rows, err
}

func (r *Repository) ControlSmartFilmProductionRun(userID, batchID, runID string, fields map[string]any) (*model.SmartFilmProductionRun, error) {
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

func (r *Repository) PendingProjectAssetCandidateCount(projectID, unitID string) (int64, error) {
	query := r.db.Model(&model.ProjectAssetCandidate{}).
		Where("project_id = ? AND status = ?", projectID, "pending_confirmation")
	if unitID != "" {
		query = query.Where("unit_id = ? OR unit_id = '' OR unit_id IS NULL", unitID)
	}
	var count int64
	return count, query.Count(&count).Error
}

func (r *Repository) MarkSmartFilmAssetStageConfirmed(projectID, unitID string) error {
	now := time.Now()
	if err := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("project_id = ? AND unit_id = ? AND asset_status IN ?", projectID, unitID, []string{"ready", "queued", "running", "needs_attention"}).
		Updates(map[string]any{"asset_status": "confirmed", "error": "", "recoverable_action": "", "updated_at": now}).Error; err != nil {
		return err
	}
	// Once every required asset is confirmed, generate the editable storyboard
	// prompts without depending on the batch page being open or refreshed.
	return r.db.Model(&model.SmartFilmProductionRun{}).
		Where("project_id = ? AND unit_id = ? AND asset_status = ? AND storyboard_status IN ?", projectID, unitID, "confirmed", []string{"pending", "waiting"}).
		Updates(map[string]any{
			"storyboard_status": "queued", "current_step": "storyboard", "status": "ready",
			"control_status": "active", "error": "", "recoverable_action": "", "updated_at": now,
		}).Error
}

func (r *Repository) RecentSucceededCanvasTextTasks(userID string, limit int) ([]model.Task, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND type = ? AND status = ?", userID, "canvas_text", model.TaskStatusSucceeded).
		Order("updated_at desc, id desc").Limit(limit).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) SmartFilmProductionRunForProject(userID, projectID string) (*model.SmartFilmProductionRun, error) {
	var run model.SmartFilmProductionRun
	err := r.db.Where("user_id = ? AND project_id = ? AND status <> ?", userID, projectID, "archived").
		Order("created_at desc, id desc").First(&run).Error
	if err != nil {
		return nil, err
	}
	return &run, nil
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
	if strings.TrimSpace(run.ControlStatus) == "" {
		run.ControlStatus = "active"
	}
	run.FailedStep = ""
	run.Error = ""
	run.RecoverableAction = ""
	run.UpdatedAt = time.Now()
	if err := r.db.Model(&model.SmartFilmProductionRun{}).
		Where("id = ? AND user_id = ?", run.ID, run.UserID).
		Updates(map[string]any{
			"status": run.Status, "current_step": run.CurrentStep, "project_id": run.ProjectID,
			"unit_id": run.UnitID, "resource_snapshot_json": run.ResourceSnapshotJSON,
			"failed_step": "", "error": "", "recoverable_action": "", "control_status": run.ControlStatus, "updated_at": run.UpdatedAt,
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
