package smartfilm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"infinite-canvas/backend/internal/model"
	localproject "infinite-canvas/backend/internal/project"
	"infinite-canvas/backend/internal/prompts"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
)

const (
	defaultInterval = 3 * time.Second
	defaultLease    = 5 * time.Minute
	workerID        = "smart-film-worker"
)

// Worker advances durable smart-film production stages. The first implemented
// stage is asset extraction; the same queue/lease model will host storyboard
// and downstream stages as they move out of the browser.
type Worker struct {
	Projects   *localproject.Service
	Repo       *repository.Repository
	SubmitTask func(userID string, req localtask.CreateRequest) (*model.Task, error)
	Log        func(userID, taskID, level, message, payload string) error
	Interval   time.Duration
	Lease      time.Duration
	active     atomic.Bool
}

func New(projects *localproject.Service, repo *repository.Repository, submit func(string, localtask.CreateRequest) (*model.Task, error), log func(string, string, string, string, string) error) *Worker {
	return &Worker{Projects: projects, Repo: repo, SubmitTask: submit, Log: log, Interval: defaultInterval, Lease: defaultLease}
}

func (w *Worker) Start(ctx context.Context) {
	if w == nil || w.Projects == nil || w.Repo == nil || w.SubmitTask == nil {
		return
	}
	if !w.active.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer w.active.Store(false)
		run := func() {
			if err := w.ProcessOnce(ctx); err != nil && w.Log != nil {
				_ = w.Log("system", "", "warn", "智能成片生产 Worker 处理失败", err.Error())
			}
		}
		run()
		interval := w.Interval
		if interval <= 0 {
			interval = defaultInterval
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}

func (w *Worker) ProcessOnce(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	items, err := w.Projects.SmartFilmAssetExtractionWorkItems(10)
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		if item.AssetTaskID != "" {
			if err := w.pollAssetExtraction(item); err != nil {
				_ = w.checkpoint(item, localproject.SmartFilmProductionStageCheckpointRequest{
					Stage: localproject.SmartFilmProductionStepAssets, Status: localproject.SmartFilmProductionStageStatusAttention, Error: err.Error(),
				})
			}
			continue
		}
		claimed, claimErr := w.Repo.ClaimSmartFilmAssetProductionRun(item.RunID, workerID, w.lease())
		if claimErr != nil || !claimed {
			continue
		}
		task, submitErr := w.submitAssetExtraction(item)
		if submitErr != nil {
			_ = w.checkpoint(item, localproject.SmartFilmProductionStageCheckpointRequest{
				Stage: localproject.SmartFilmProductionStepAssets, Status: localproject.SmartFilmProductionStageStatusAttention, Error: submitErr.Error(),
			})
			continue
		}
		_, _ = w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, localproject.SmartFilmProductionStageCheckpointRequest{
			Stage: localproject.SmartFilmProductionStepAssets, Status: localproject.SmartFilmProductionStageStatusRunning, TaskID: task.ID,
		})
	}
	return nil
}

func (w *Worker) submitAssetExtraction(item localproject.SmartFilmAssetExtractionWorkItem) (*model.Task, error) {
	channelID, modelName := SplitModelOption(item.TextModel)
	if strings.TrimSpace(modelName) == "" {
		return nil, errors.New("批次没有可用的文本模型")
	}
	config := map[string]any{"model": modelName}
	if channelID != "" {
		config["channelId"] = channelID
	}
	input := map[string]any{
		"mode": "text", "prompt": "章节资产提取", "config": config,
		"metadata": map[string]any{
			"domainProjectId":         item.ProjectID,
			"chapterId":               item.UnitID,
			"source":                  "smart-film-batch-worker",
			"clientOperationId":       fmt.Sprintf("smart-film:assets:%s", item.RunID),
			"promptTemplateOperation": prompts.OperationChapterAssetsExtract,
			"promptTemplateVariables": map[string]string{
				"项目名称": item.ProjectName,
				"章节名称": item.ScriptTitle,
				"项目画风": DefaultString(item.ProjectStyle, "项目尚未指定画风，保持视觉描述中性、可执行。"),
				"章节正文": item.ScriptContent,
			},
		},
	}
	return w.SubmitTask(item.UserID, localtask.CreateRequest{
		ProjectID: item.ProjectID, Type: "canvas_text", Operation: "chapter_character_breakdown",
		Prompt: "章节资产提取", Model: modelName, Input: input,
	})
}

func (w *Worker) pollAssetExtraction(item localproject.SmartFilmAssetExtractionWorkItem) error {
	task, err := w.Repo.TaskForUser(item.UserID, item.AssetTaskID)
	if err != nil {
		return fmt.Errorf("读取资产提取任务失败：%w", err)
	}
	switch task.Status {
	case model.TaskStatusQueued, model.TaskStatusRunning:
		_ = w.Repo.RenewSmartFilmAssetProductionLease(item.RunID, workerID, w.lease())
		return nil
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		return errors.New(DefaultString(task.Error, "资产提取任务失败"))
	case model.TaskStatusSucceeded:
		created, createErr := w.applyAssetExtraction(item, task)
		if createErr != nil {
			return createErr
		}
		if markErr := w.markAssetsExtracted(item); markErr != nil {
			return markErr
		}
		_, _ = w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, localproject.SmartFilmProductionStageCheckpointRequest{
			Stage: localproject.SmartFilmProductionStepAssets, Status: localproject.SmartFilmProductionStageStatusReady,
			TaskID: task.ID, ResourceCount: len(created),
		})
		return nil
	default:
		return fmt.Errorf("资产提取任务状态不可处理：%s", task.Status)
	}
}

func (w *Worker) markAssetsExtracted(item localproject.SmartFilmAssetExtractionWorkItem) error {
	batch, err := w.Projects.SmartFilmBatch(item.UserID, item.BatchID)
	if err != nil {
		return err
	}
	_, err = w.Projects.UpdateSmartFilmBatchScript(item.UserID, item.BatchID, item.ScriptID, localproject.UpdateSmartFilmBatchScriptRequest{
		Title: item.ScriptTitle, Content: item.ScriptContent, Status: localproject.SmartFilmScriptStatusAssetsExtracted,
		ExpectedRevision: batch.Revision,
	})
	return err
}

func (w *Worker) applyAssetExtraction(item localproject.SmartFilmAssetExtractionWorkItem, task *model.Task) ([]model.ProjectAssetCandidate, error) {
	var result struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return nil, fmt.Errorf("资产提取结果无法读取：%w", err)
	}
	payload, err := DecodeJSONObject(result.Text)
	if err != nil {
		return nil, err
	}
	candidates := make([]localproject.AssetCandidateInput, 0)
	for _, raw := range JSONArray(payload["characters"]) {
		details := JSONMap(raw)
		name := strings.TrimSpace(JSONString(details["name"]))
		if name == "" {
			continue
		}
		candidates = append(candidates, localproject.AssetCandidateInput{UnitID: item.UnitID, Name: name, Category: "character", Details: details})
	}
	for _, group := range []struct {
		key      string
		category string
	}{{"scenes", "environment"}, {"props", "prop"}} {
		for _, raw := range JSONArray(payload[group.key]) {
			details := JSONMap(raw)
			name := strings.TrimSpace(JSONString(details["name"]))
			if name == "" {
				continue
			}
			candidates = append(candidates, localproject.AssetCandidateInput{UnitID: item.UnitID, Name: name, Category: group.category, Details: details})
		}
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	return w.Projects.CreateProjectAssetCandidates(item.UserID, item.ProjectID, localproject.CreateAssetCandidatesRequest{
		Candidates: candidates, Source: localproject.AssetCandidateSourceChapterCharacter, SourceTaskID: task.ID,
	})
}

func (w *Worker) checkpoint(item localproject.SmartFilmAssetExtractionWorkItem, req localproject.SmartFilmProductionStageCheckpointRequest) error {
	_, err := w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, req)
	return err
}

func (w *Worker) lease() time.Duration {
	if w == nil || w.Lease <= 0 {
		return defaultLease
	}
	return w.Lease
}

func SplitModelOption(value string) (string, string) {
	value = strings.TrimSpace(value)
	if parts := strings.SplitN(value, "::", 2); len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", value
}

func DecodeJSONObject(value string) (map[string]any, error) {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)
	if start, end := strings.Index(trimmed, "{"), strings.LastIndex(trimmed, "}"); start >= 0 && end > start {
		trimmed = trimmed[start : end+1]
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return nil, fmt.Errorf("资产提取结果 JSON 无效：%w", err)
	}
	return payload, nil
}

func JSONArray(value any) []any {
	items, _ := value.([]any)
	return items
}

func JSONMap(value any) map[string]any {
	item, _ := value.(map[string]any)
	if item == nil {
		return map[string]any{}
	}
	return item
}

func JSONString(value any) string {
	text, _ := value.(string)
	return text
}

func DefaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
