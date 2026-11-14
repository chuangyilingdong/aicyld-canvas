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

// Worker advances durable smart-film production stages. The same queue/lease
// model owns asset extraction and storyboard generation so closing the browser
// cannot interrupt a confirmed batch.
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
		if item.ConfigurationError != "" {
			_ = w.checkpoint(item, localproject.SmartFilmProductionStageCheckpointRequest{
				Stage: localproject.SmartFilmProductionStepAssets, Status: localproject.SmartFilmProductionStageStatusAttention, Error: item.ConfigurationError,
			})
			continue
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
	storyboards, err := w.Projects.SmartFilmStoryboardWorkItems(10)
	if err != nil {
		return err
	}
	for _, item := range storyboards {
		if err := ctx.Err(); err != nil {
			return err
		}
		if item.ConfigurationError != "" {
			_ = w.checkpointStoryboard(item, localproject.SmartFilmProductionStageCheckpointRequest{
				Stage: localproject.SmartFilmProductionStepStoryboard, Status: localproject.SmartFilmProductionStageStatusAttention, Error: item.ConfigurationError,
			})
			continue
		}
		if item.StoryboardTaskID != "" {
			if err := w.pollStoryboard(item); err != nil {
				_ = w.checkpointStoryboard(item, localproject.SmartFilmProductionStageCheckpointRequest{
					Stage: localproject.SmartFilmProductionStepStoryboard, Status: localproject.SmartFilmProductionStageStatusAttention,
					TaskID: item.StoryboardTaskID, Error: err.Error(),
				})
			}
			continue
		}
		claimed, claimErr := w.Repo.ClaimSmartFilmStoryboardProductionRun(item.RunID, workerID, w.lease())
		if claimErr != nil || !claimed {
			continue
		}
		task, submitErr := w.submitStoryboard(item)
		if submitErr != nil {
			_ = w.checkpointStoryboard(item, localproject.SmartFilmProductionStageCheckpointRequest{
				Stage: localproject.SmartFilmProductionStepStoryboard, Status: localproject.SmartFilmProductionStageStatusAttention, Error: submitErr.Error(),
			})
			continue
		}
		_, _ = w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, localproject.SmartFilmProductionStageCheckpointRequest{
			Stage: localproject.SmartFilmProductionStepStoryboard, Status: localproject.SmartFilmProductionStageStatusRunning, TaskID: task.ID,
		})
	}
	return nil
}

func (w *Worker) submitAssetExtraction(item localproject.SmartFilmAssetExtractionWorkItem) (*model.Task, error) {
	channelID, modelName := SplitModelOption(item.TextModel)
	if strings.TrimSpace(modelName) == "" {
		return nil, errors.New("批次没有可用的文本模型")
	}
	config := make(map[string]any, len(item.TextConfig)+2)
	for key, value := range item.TextConfig {
		config[key] = value
	}
	config["model"] = modelName
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
		Prompt: "章节资产提取", Model: modelName, LogicalModelID: item.LogicalModelID, Input: input,
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
		status := localproject.SmartFilmProductionStageStatusReady
		pending, pendingErr := w.Repo.PendingProjectAssetCandidateCount(item.ProjectID, item.UnitID)
		if pendingErr != nil {
			return pendingErr
		}
		if pending == 0 {
			status = localproject.SmartFilmProductionStageStatusConfirmed
		}
		_, _ = w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, localproject.SmartFilmProductionStageCheckpointRequest{
			Stage: localproject.SmartFilmProductionStepAssets, Status: status,
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

func (w *Worker) submitStoryboard(item localproject.SmartFilmStoryboardWorkItem) (*model.Task, error) {
	channelID, modelName := SplitModelOption(item.TextModel)
	if modelName == "" {
		return nil, errors.New("批次没有可用的文本模型")
	}
	config := make(map[string]any, len(item.TextConfig)+2)
	for key, value := range item.TextConfig {
		config[key] = value
	}
	config["model"] = modelName
	if channelID != "" {
		config["channelId"] = channelID
	}
	assetsJSON, _ := json.Marshal(item.Assets)
	input := map[string]any{
		"mode": "text", "prompt": "短剧分镜规划", "config": config,
		"canvasAssets": item.Assets,
		"requirements": "只使用当前项目已确认资产；每个镜头只绑定实际出现在画面中的角色、场景和道具。",
		"shotCount":    item.ShotCount, "shotDurationSeconds": item.ShotDurationSeconds,
		"shotDurationsSeconds": item.ShotDurationsSeconds,
		"metadata": map[string]any{
			"domainProjectId": item.ProjectID, "chapterId": item.UnitID,
			"source": "smart-film-batch-worker", "clientOperationId": fmt.Sprintf("smart-film:storyboard:%s", item.RunID),
		},
	}
	return w.SubmitTask(item.UserID, localtask.CreateRequest{
		ProjectID: item.ProjectID, Type: "canvas_text", Operation: "storyboard",
		Prompt: storyboardPrompt(item, assetsJSON), Model: modelName, LogicalModelID: item.LogicalModelID, Input: input,
	})
}

func (w *Worker) pollStoryboard(item localproject.SmartFilmStoryboardWorkItem) error {
	task, err := w.Repo.TaskForUser(item.UserID, item.StoryboardTaskID)
	if err != nil {
		return fmt.Errorf("读取分镜任务失败：%w", err)
	}
	switch task.Status {
	case model.TaskStatusQueued, model.TaskStatusRunning:
		_ = w.Repo.RenewSmartFilmStoryboardProductionLease(item.RunID, workerID, w.lease())
		return nil
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		return errors.New(DefaultString(task.Error, "分镜任务失败"))
	case model.TaskStatusSucceeded:
		shots, err := w.applyStoryboard(item, task)
		if err != nil {
			return err
		}
		if err := w.markStoryboardReady(item); err != nil {
			return err
		}
		_, _ = w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, localproject.SmartFilmProductionStageCheckpointRequest{
			Stage: localproject.SmartFilmProductionStepStoryboard, Status: localproject.SmartFilmProductionStageStatusReady,
			TaskID: task.ID, ResourceCount: len(shots),
		})
		return nil
	default:
		return fmt.Errorf("分镜任务状态不可处理：%s", task.Status)
	}
}

func (w *Worker) markStoryboardReady(item localproject.SmartFilmStoryboardWorkItem) error {
	batch, err := w.Projects.SmartFilmBatch(item.UserID, item.BatchID)
	if err != nil {
		return err
	}
	_, err = w.Projects.UpdateSmartFilmBatchScript(item.UserID, item.BatchID, item.ScriptID, localproject.UpdateSmartFilmBatchScriptRequest{
		Title: item.ScriptTitle, Content: item.ScriptContent, Status: localproject.SmartFilmScriptStatusStoryboardReady,
		ExpectedRevision: batch.Revision,
	})
	return err
}

func (w *Worker) applyStoryboard(item localproject.SmartFilmStoryboardWorkItem, task *model.Task) ([]model.Shot, error) {
	payload, err := storyboardTaskPayload(task)
	if err != nil {
		return nil, err
	}
	rows := JSONArray(payload["rows"])
	if len(rows) == 0 {
		rows = JSONArray(payload["shots"])
	}
	if len(rows) == 0 {
		return nil, errors.New("分镜任务没有返回镜头行")
	}
	project, err := w.Projects.Owned(item.UserID, item.ProjectID)
	if err != nil {
		return nil, err
	}
	shots := make([]localproject.ReplaceProjectUnitShotInput, 0, len(rows))
	for index, raw := range rows {
		row := JSONMap(raw)
		durationSeconds := rowFloat(row["durationSeconds"])
		// Batch configuration is the execution contract. Model output may round or
		// ignore durations, but it must not override the user-confirmed per-shot plan.
		if len(item.ShotDurationsSeconds) > index {
			durationSeconds = item.ShotDurationsSeconds[index]
		}
		if durationSeconds <= 0 {
			durationSeconds = item.ShotDurationSeconds
		}
		if durationSeconds <= 0 {
			durationSeconds = 5
		}
		durationMs := int64(durationSeconds * 1000)
		plot := DefaultString(rowString(row["plotDescription"]), rowString(row["description"]))
		if strings.TrimSpace(plot) == "" {
			plot = fmt.Sprintf("镜头 %d", index+1)
		}
		description := DefaultString(rowString(row["visualPrompt"]), plot)
		assetIDs, assetVersions, assetRoles := storyboardRowAssets(row, item.Assets)
		imagePrompt := withAssetMentions(rowString(row["imageGenerationPrompt"]), assetIDs)
		videoPrompt := withAssetMentions(rowString(row["videoMotionPrompt"]), assetIDs)
		shots = append(shots, localproject.ReplaceProjectUnitShotInput{
			CreateProjectShotRequest: localproject.CreateProjectShotRequest{
				UnitID: item.UnitID, Title: fmt.Sprintf("镜头 %d", index+1), Description: description,
				Position: index, DurationMs: durationMs,
				Revision: localproject.ShotRevisionInput{
					PlotDescription: plot, Action: storyboardAction(row), Dialogue: rowString(row["dialogue"]),
					ShotSize: rowString(row["shotSize"]), CameraAngle: rowString(row["camera"]),
					CameraMovement: rowString(row["motion"]), DurationMs: durationMs, ImagePrompt: imagePrompt,
					VideoPrompt: videoPrompt, NegativePrompt: rowString(row["negativePrompt"]),
					ContinuityNotes: rowString(row["continuityOut"]),
					ActionBeats:     actionBeats(row), AssetRoles: assetRoles,
				},
			},
			AssetVersionIDs: assetVersions,
		})
	}
	existing, err := w.Repo.ProjectUnitShots(item.ProjectID, item.UnitID)
	if err != nil {
		return nil, err
	}
	expected := make([]string, 0, len(existing))
	for _, shot := range existing {
		expected = append(expected, shot.ID)
	}
	return w.Projects.ReplaceProjectUnitShots(item.UserID, item.ProjectID, item.UnitID, localproject.ReplaceProjectUnitShotsRequest{
		Shots: shots, ExpectedShotIDs: expected, ExpectedRevision: project.Revision, SourceTaskID: task.ID,
	})
}

func (w *Worker) checkpointStoryboard(item localproject.SmartFilmStoryboardWorkItem, req localproject.SmartFilmProductionStageCheckpointRequest) error {
	_, err := w.Projects.CheckpointSmartFilmProductionRun(item.UserID, item.BatchID, item.RunID, req)
	return err
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

func storyboardTaskPayload(task *model.Task) (map[string]any, error) {
	if task == nil {
		return nil, errors.New("分镜任务不存在")
	}
	var result struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return nil, fmt.Errorf("分镜结果无法读取：%w", err)
	}
	if strings.TrimSpace(result.Text) == "" {
		return DecodeJSONObject(task.ResultJSON)
	}
	return DecodeJSONObject(result.Text)
}

func storyboardPrompt(item localproject.SmartFilmStoryboardWorkItem, assetsJSON []byte) string {
	durationRule := fmt.Sprintf("单镜时长约 %.1f 秒", item.ShotDurationSeconds)
	if len(item.ShotDurationsSeconds) > 0 {
		durationRule = fmt.Sprintf("逐镜时长按顺序为 %v 秒", item.ShotDurationsSeconds)
	}
	countRule := fmt.Sprintf("严格输出 %d 个镜头", item.ShotCount)
	if item.ShotCount <= 0 {
		countRule = "按完整覆盖剧情的需要输出镜头"
	}
	return strings.Join([]string{
		"你是影视分镜导演和 AI 视频提示词专家。只基于本条独立剧本创作，不要引用其他批次或项目内容。",
		"【剧情】\n" + item.ScriptContent,
		"【项目画风】\n" + DefaultString(item.ProjectStyle, "保持视觉描述中性、可执行。"),
		"【当前已确认资产】\n" + string(assetsJSON),
		"【执行约束】\n- " + durationRule + "\n- " + countRule + "\n- 每个镜头只绑定实际出现的角色、场景和道具；禁止把全部产品图无差别塞入每个镜头。\n- assetRefs 只能使用当前已确认资产中的 ID；没有相关资产时返回空数组。\n- 单镜头最多 2 名主要角色、1 个主运镜、一条主要动作链、3 个 timeBeats 和 3 个 mustHave。\n- dialogue 只写本镜头实际念出的台词或简短旁白。\n- 只返回一个 JSON 对象，不要 Markdown、代码块或解释。",
		"【输出结构】\n" + `{"title":"string","rows":[{"shotNumber":1,"durationSeconds":5,"plotDescription":"","dialogue":"","characters":[],"narrativeIntent":"","viewerPOV":"","performanceBlocking":"","shotSize":"","emotion":"","lightingAndAtmosphere":"","audioEffects":"","camera":"","motion":"","timeBeats":"","imageGenerationPrompt":"","videoMotionPrompt":"","continuityOut":"","negativePrompt":"","mustHave":[],"optionalDetails":[],"assetRefs":[{"nodeId":"asset-id","role":"character","priority":100}]}]}`,
	}, "\n\n")
}

func rowString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := rowString(item); text != "" {
				items = append(items, text)
			}
		}
		return strings.Join(items, "\n")
	case map[string]any:
		encoded, _ := json.Marshal(typed)
		return string(encoded)
	default:
		if value == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func rowFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	default:
		var number float64
		_, _ = fmt.Sscan(fmt.Sprint(value), &number)
		return number
	}
}

func storyboardAction(row map[string]any) string {
	labels := []struct{ label, key string }{{"叙事意图", "narrativeIntent"}, {"表演调度", "performanceBlocking"}, {"时间节拍", "timeBeats"}, {"情绪", "emotion"}, {"光线与氛围", "lightingAndAtmosphere"}, {"声音", "audioEffects"}}
	parts := make([]string, 0, len(labels))
	for _, item := range labels {
		if text := rowString(row[item.key]); text != "" {
			parts = append(parts, item.label+"："+text)
		}
	}
	return strings.Join(parts, "\n")
}

func actionBeats(row map[string]any) []map[string]any {
	text := rowString(row["timeBeats"])
	if text == "" {
		return nil
	}
	return []map[string]any{{"description": text}}
}

func withAssetMentions(prompt string, assetIDs []string) string {
	if len(assetIDs) == 0 || strings.Contains(prompt, "@[asset:") {
		return prompt
	}
	mentions := make([]string, 0, len(assetIDs))
	for _, assetID := range assetIDs {
		mentions = append(mentions, "@[asset:"+assetID+"]")
	}
	if strings.TrimSpace(prompt) == "" {
		return strings.Join(mentions, " ")
	}
	return prompt + "\n\n" + strings.Join(mentions, " ")
}

func storyboardRowAssets(row map[string]any, assets []localproject.SmartFilmStoryboardAsset) ([]string, []string, []localproject.ShotAssetRole) {
	byID := make(map[string]localproject.SmartFilmStoryboardAsset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	selected := make([]localproject.SmartFilmStoryboardAsset, 0, 6)
	seen := make(map[string]bool)
	add := func(id string) {
		id = strings.TrimSpace(id)
		asset, ok := byID[id]
		if !ok || seen[id] || len(selected) >= 6 {
			return
		}
		seen[id] = true
		selected = append(selected, asset)
	}
	for _, key := range []string{"assetRefs", "assetBindings", "assets"} {
		for _, raw := range JSONArray(row[key]) {
			ref := JSONMap(raw)
			add(DefaultString(JSONString(ref["nodeId"]), DefaultString(JSONString(ref["assetId"]), JSONString(ref["id"]))))
		}
	}
	for _, raw := range JSONArray(row["characters"]) {
		if character := strings.ToLower(strings.TrimSpace(rowString(raw))); character != "" {
			for _, asset := range assets {
				if strings.EqualFold(asset.Title, character) {
					add(asset.ID)
				}
			}
		}
	}
	haystack := strings.ToLower(strings.Join([]string{
		rowString(row["plotDescription"]), rowString(row["description"]), rowString(row["dialogue"]),
		rowString(row["imageGenerationPrompt"]), rowString(row["videoMotionPrompt"]),
	}, "\n"))
	for _, asset := range assets {
		title := strings.ToLower(strings.TrimSpace(asset.Title))
		if title != "" && strings.Contains(haystack, title) {
			add(asset.ID)
		}
	}
	ids := make([]string, 0, len(selected))
	versions := make([]string, 0, len(selected))
	roles := make([]localproject.ShotAssetRole, 0, len(selected))
	for _, asset := range selected {
		ids = append(ids, asset.ID)
		if asset.PrimaryVersionID != "" {
			versions = append(versions, asset.PrimaryVersionID)
		}
		role := asset.Category
		if role == "" {
			role = "reference"
		}
		roles = append(roles, localproject.ShotAssetRole{AssetID: asset.ID, VersionID: asset.PrimaryVersionID, Title: asset.Title, Role: role})
	}
	return ids, versions, roles
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
		return nil, fmt.Errorf("生成结果 JSON 无效：%w", err)
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
