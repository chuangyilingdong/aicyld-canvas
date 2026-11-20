package project

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) SmartFilmBatchBilling(userID, batchID string, page, pageSize int) (SmartFilmBatchBillingView, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 100 {
		pageSize = 100
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchBillingView{}, err
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchBillingView{}, err
	}
	tasks, total, err := s.repo.SmartFilmBatchTasksPage(userID, batchID, page, pageSize)
	if err != nil {
		return SmartFilmBatchBillingView{}, err
	}
	totals, err := s.repo.SmartFilmBatchBillingTotals(userID, batchID)
	if err != nil {
		return SmartFilmBatchBillingView{}, err
	}
	committed, err := s.repo.SmartFilmBatchCommittedPoints(userID, batchID)
	if err != nil {
		return SmartFilmBatchBillingView{}, err
	}
	scriptByProject := make(map[string]SmartFilmScript, len(scripts))
	for _, script := range scripts {
		if script.ProjectID != "" {
			scriptByProject[script.ProjectID] = script
		}
	}
	view := SmartFilmBatchBillingView{
		BudgetPoints: batch.BudgetPoints, CommittedPoints: committed,
		ReservedPoints: totals.ReservedPoints, SettledPoints: totals.SettledPoints,
		RefundedPoints: totals.RefundedPoints, PendingPoints: totals.PendingPoints,
		UnbilledTasks: totals.UnbilledTasks, ActiveTasks: totals.ActiveTasks, TerminalTasks: totals.TerminalTasks,
		Page: page, PageSize: pageSize, Total: total, HasMore: int64(page*pageSize) < total,
		Tasks: make([]SmartFilmBillingTaskView, 0, len(tasks)),
	}
	for _, task := range tasks {
		metadata := smartFilmTaskMetadata(task)
		projectID := firstNonEmpty(stringValue(metadata["domainProjectId"]), stringValue(metadata["projectId"]), task.ProjectID)
		source := stringValue(metadata["source"])
		stage, label := smartFilmTaskStage(task, metadata)
		billingStatus := strings.TrimSpace(task.BillingStatus)
		if billingStatus == "" || billingStatus == "free" {
			billingStatus = "unbilled"
		}
		reservedPoints := task.BillingReservedPoints
		settledPoints := task.BillingSettledPoints
		refundedPoints := task.BillingRefundedPoints
		if reservedPoints <= 0 && billingStatus != "unbilled" && billingStatus != "refunded" {
			reservedPoints = task.BillingPoints
		}
		if settledPoints <= 0 && billingStatus == "settled" {
			settledPoints = task.BillingPoints
		}
		if refundedPoints <= 0 && billingStatus == "refunded" {
			refundedPoints = reservedPoints
			if refundedPoints <= 0 {
				refundedPoints = task.BillingPoints
			}
		}
		script := scriptByProject[projectID]
		view.Tasks = append(view.Tasks, SmartFilmBillingTaskView{
			TaskID: task.ID, ScriptID: script.ID, ScriptTitle: script.Title,
			ProjectID: projectID, UnitID: firstNonEmpty(stringValue(metadata["unitId"]), stringValue(metadata["chapterId"])),
			ShotID: stringValue(metadata["shotId"]), Stage: stage, Label: label, Source: source,
			Model: task.Model, Status: string(task.Status), BillingStatus: billingStatus,
			ReservedPoints: reservedPoints, SettledPoints: settledPoints, RefundedPoints: refundedPoints,
			BillingPoints: task.BillingPoints, ProviderRequestID: task.ProviderRequestID,
			Error: task.Error, CreatedAt: task.CreatedAt, StartedAt: task.StartedAt, CompletedAt: task.CompletedAt,
		})
	}
	return view, nil
}

func smartFilmTaskMetadata(task model.Task) map[string]any {
	var input struct {
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return map[string]any{}
	}
	if input.Metadata == nil {
		return map[string]any{}
	}
	return input.Metadata
}

func smartFilmTaskStage(task model.Task, metadata map[string]any) (string, string) {
	source := stringValue(metadata["source"])
	artifactType := strings.ToLower(stringValue(metadata["artifactType"]))
	switch {
	case source == "smart-film-batch-script":
		return "script", "多剧本生成"
	case source == "smart-film-batch-worker" && task.Operation == "chapter_character_breakdown":
		return "assets", "角色、场景与道具提取"
	case source == "smart-film-batch-worker" && task.Operation == "storyboard":
		return "storyboard", "分镜规划"
	case source == "smart-film-narration" || stringValue(metadata["audioPurpose"]) == "voice":
		return "narration", "镜头旁白"
	case source == "smart-film-bgm" || stringValue(metadata["audioPurpose"]) == "music":
		return "bgm", "背景音乐"
	case source == "smart-film-whole-video":
		return "whole_video", "整片视频"
	case artifactType == "storyboard" || strings.Contains(task.Type, "image"):
		return "storyboard_image", "分镜图"
	case artifactType == "video" || strings.Contains(task.Type, "video"):
		return "shot_video", "镜头视频"
	default:
		return task.Operation, task.Operation
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
