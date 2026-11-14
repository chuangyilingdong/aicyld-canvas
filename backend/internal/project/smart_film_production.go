package project

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
)

func (s *Service) CheckpointSmartFilmProductionRun(userID, batchID, runID string, req SmartFilmProductionStageCheckpointRequest) (SmartFilmProductionRunView, error) {
	stage := strings.TrimSpace(req.Stage)
	status := strings.TrimSpace(req.Status)
	if stage != SmartFilmProductionStepAssets && stage != SmartFilmProductionStepStoryboard {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("生产阶段无效")
	}
	switch status {
	case SmartFilmProductionStageStatusPending, SmartFilmProductionStageStatusWaiting, SmartFilmProductionStageStatusQueued, SmartFilmProductionStageStatusRunning, SmartFilmProductionStageStatusReady, SmartFilmProductionStageStatusConfirmed, SmartFilmProductionStageStatusAttention:
		if status == SmartFilmProductionStageStatusConfirmed && stage != SmartFilmProductionStepAssets {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest("只有资产阶段可以确认")
		}
	default:
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("生产阶段状态无效")
	}
	fields := map[string]any{"current_step": stage}
	switch stage {
	case SmartFilmProductionStepAssets:
		fields["asset_status"] = status
		fields["asset_task_id"] = strings.TrimSpace(req.TaskID)
		fields["asset_count"] = req.ResourceCount
	case SmartFilmProductionStepStoryboard:
		fields["storyboard_status"] = status
		fields["storyboard_task_id"] = strings.TrimSpace(req.TaskID)
		fields["storyboard_shot_count"] = req.ResourceCount
	}
	if status == SmartFilmProductionStageStatusAttention {
		fields["error"] = truncateSmartFilmText(req.Error, 2000)
		fields["status"] = SmartFilmProductionRunStatusNeedsAttention
		fields["failed_step"] = stage
		if stage == SmartFilmProductionStepAssets {
			fields["recoverable_action"] = SmartFilmProductionActionRetryAssets
		} else {
			fields["recoverable_action"] = SmartFilmProductionActionRetryStoryboard
		}
	} else {
		fields["error"] = ""
		fields["recoverable_action"] = ""
		fields["failed_step"] = ""
		if status != SmartFilmProductionStageStatusPending && status != SmartFilmProductionStageStatusWaiting {
			fields["status"] = SmartFilmProductionRunStatusReady
		}
	}
	run, err := s.repo.UpdateSmartFilmProductionRunStage(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	return smartFilmProductionRunView(*run), nil
}

func (s *Service) StartSmartFilmProductionStage(userID, batchID, runID string, req StartSmartFilmProductionStageRequest) (SmartFilmProductionRunView, error) {
	stage := strings.TrimSpace(req.Stage)
	if stage != SmartFilmProductionStepAssets && stage != SmartFilmProductionStepStoryboard {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("生产阶段无效")
	}
	run, err := s.repo.SmartFilmProductionRunForUser(userID, batchID, runID)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	if run.ControlStatus == SmartFilmProductionControlSkipped || run.Status == SmartFilmProductionRunStatusSkipped {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("已跳过的项目不能启动生产阶段")
	}
	if stage == SmartFilmProductionStepStoryboard {
		if run.AssetStatus != SmartFilmProductionStageStatusReady && run.AssetStatus != SmartFilmProductionStageStatusConfirmed {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest("资产提取尚未完成，不能生成分镜")
		}
		pending, pendingErr := s.repo.PendingProjectAssetCandidateCount(run.ProjectID, run.UnitID)
		if pendingErr != nil {
			return SmartFilmProductionRunView{}, pendingErr
		}
		if pending > 0 {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest(fmt.Sprintf("还有 %d 个资产待确认，不能生成分镜", pending))
		}
		if run.AssetStatus == SmartFilmProductionStageStatusReady {
			_ = s.repo.MarkSmartFilmAssetStageConfirmed(run.ProjectID, run.UnitID)
		}
	}
	fields := map[string]any{
		"current_step": stage, "status": SmartFilmProductionRunStatusReady,
		"error": "", "recoverable_action": "", "worker_lease_owner": "", "worker_lease_until": nil,
		"control_status": SmartFilmProductionControlActive,
	}
	if stage == SmartFilmProductionStepAssets {
		fields["asset_status"] = SmartFilmProductionStageStatusQueued
	} else {
		fields["storyboard_status"] = SmartFilmProductionStageStatusQueued
		fields["asset_status"] = SmartFilmProductionStageStatusConfirmed
	}
	run, err = s.repo.UpdateSmartFilmProductionRunStage(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	return smartFilmProductionRunView(*run), nil
}

func (s *Service) ControlSmartFilmBatch(userID, batchID string, req SmartFilmBatchControlRequest) (SmartFilmBatchView, error) {
	action := strings.TrimSpace(req.Action)
	if action != "pause" && action != "resume" {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次控制动作无效")
	}
	batch, err := s.repo.SetSmartFilmBatchPaused(userID, batchID, action == "pause")
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*batch)
}

func (s *Service) ControlSmartFilmProductionRun(userID, batchID, runID string, req SmartFilmProductionRunControlRequest) (SmartFilmProductionRunView, error) {
	action := strings.TrimSpace(req.Action)
	run, err := s.repo.SmartFilmProductionRunForUser(userID, batchID, runID)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	fields := map[string]any{}
	switch action {
	case "pause":
		fields["control_status"] = SmartFilmProductionControlPaused
	case "resume":
		if run.Status == SmartFilmProductionRunStatusSkipped {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest("已跳过的项目不能继续，请重新加入批次")
		}
		fields["control_status"] = SmartFilmProductionControlActive
	case "skip":
		fields["control_status"] = SmartFilmProductionControlSkipped
		fields["status"] = SmartFilmProductionRunStatusSkipped
		fields["current_step"] = SmartFilmProductionRunStatusSkipped
		fields["worker_lease_owner"] = ""
		fields["worker_lease_until"] = nil
	case "retry":
		stage := strings.TrimSpace(req.Stage)
		if stage == "" {
			stage = run.FailedStep
		}
		if stage != SmartFilmProductionStepAssets && stage != SmartFilmProductionStepStoryboard {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest("没有可重试的失败阶段")
		}
		if stage == SmartFilmProductionStepStoryboard {
			if run.AssetStatus != SmartFilmProductionStageStatusReady && run.AssetStatus != SmartFilmProductionStageStatusConfirmed {
				return SmartFilmProductionRunView{}, kernel.BadAuthRequest("资产提取尚未完成，不能重试分镜")
			}
			pending, pendingErr := s.repo.PendingProjectAssetCandidateCount(run.ProjectID, run.UnitID)
			if pendingErr != nil {
				return SmartFilmProductionRunView{}, pendingErr
			}
			if pending > 0 {
				return SmartFilmProductionRunView{}, kernel.BadAuthRequest(fmt.Sprintf("还有 %d 个资产待确认，不能重试分镜", pending))
			}
		}
		fields["control_status"] = SmartFilmProductionControlActive
		fields["status"] = SmartFilmProductionRunStatusReady
		fields["current_step"] = stage
		fields["failed_step"] = ""
		fields["error"] = ""
		fields["recoverable_action"] = ""
		fields["worker_lease_owner"] = ""
		fields["worker_lease_until"] = nil
		if stage == SmartFilmProductionStepAssets {
			fields["asset_status"] = SmartFilmProductionStageStatusQueued
		} else {
			fields["storyboard_status"] = SmartFilmProductionStageStatusQueued
		}
	default:
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("项目控制动作无效")
	}
	updated, err := s.repo.ControlSmartFilmProductionRun(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, mapProjectWriteError(err)
	}
	return smartFilmProductionRunView(*updated), nil
}

func (s *Service) SmartFilmAssetExtractionWorkItems(limit int) ([]SmartFilmAssetExtractionWorkItem, error) {
	runs, err := s.repo.SmartFilmAssetProductionRuns(limit)
	if err != nil {
		return nil, err
	}
	items := make([]SmartFilmAssetExtractionWorkItem, 0, len(runs))
	for _, run := range runs {
		batch, batchErr := s.repo.SmartFilmBatchForUser(run.UserID, run.BatchID)
		if batchErr != nil {
			continue
		}
		scripts, scriptErr := smartFilmScripts(batch)
		if scriptErr != nil {
			continue
		}
		index := smartFilmScriptIndex(scripts, run.ScriptID)
		if index < 0 {
			continue
		}
		script := scripts[index]
		if run.ProjectID == "" || run.UnitID == "" {
			continue
		}
		config, configErr := smartFilmBatchConfig(batch)
		if configErr != nil {
			continue
		}
		project, projectErr := s.repo.ProjectForUser(run.UserID, run.ProjectID)
		if projectErr != nil {
			continue
		}
		stylePrompt := ""
		if strings.TrimSpace(project.StyleProfileJSON) != "" {
			var style prompts.StyleProfileDocument
			if json.Unmarshal([]byte(project.StyleProfileJSON), &style) == nil {
				stylePrompt = style.Prompt
			}
		}
		textModel, textConfig, snapshotErr := s.smartFilmTextStageConfig(config, batch)
		items = append(items, SmartFilmAssetExtractionWorkItem{
			RunID: run.ID, UserID: run.UserID, BatchID: run.BatchID, ScriptID: run.ScriptID,
			ProjectID: run.ProjectID, UnitID: run.UnitID, ProjectName: project.Name, ProjectStyle: stylePrompt,
			ScriptTitle: script.Title, ScriptContent: script.Content,
			TextModel: textModel, TextConfig: textConfig, LogicalModelID: stringValue(textConfig["logicalModelId"]), ConfigurationError: errorText(snapshotErr),
			AssetTaskID: run.AssetTaskID, AssetStatus: run.AssetStatus,
		})
	}
	return items, nil
}

func (s *Service) SmartFilmStoryboardWorkItems(limit int) ([]SmartFilmStoryboardWorkItem, error) {
	runs, err := s.repo.SmartFilmStoryboardProductionRuns(limit)
	if err != nil {
		return nil, err
	}
	items := make([]SmartFilmStoryboardWorkItem, 0, len(runs))
	for _, run := range runs {
		batch, batchErr := s.repo.SmartFilmBatchForUser(run.UserID, run.BatchID)
		if batchErr != nil {
			continue
		}
		scripts, scriptErr := smartFilmScripts(batch)
		if scriptErr != nil {
			continue
		}
		index := smartFilmScriptIndex(scripts, run.ScriptID)
		if index < 0 {
			continue
		}
		pending, pendingErr := s.repo.PendingProjectAssetCandidateCount(run.ProjectID, run.UnitID)
		if pendingErr != nil || pending > 0 {
			continue
		}
		if run.AssetStatus == SmartFilmProductionStageStatusReady {
			if markErr := s.repo.MarkSmartFilmAssetStageConfirmed(run.ProjectID, run.UnitID); markErr != nil {
				continue
			}
			run.AssetStatus = SmartFilmProductionStageStatusConfirmed
		}
		config, configErr := smartFilmBatchConfig(batch)
		if configErr != nil {
			continue
		}
		project, projectErr := s.repo.ProjectForUser(run.UserID, run.ProjectID)
		if projectErr != nil {
			continue
		}
		unit, unitErr := s.repo.ProjectUnit(run.ProjectID, run.UnitID)
		if unitErr != nil {
			continue
		}
		stylePrompt := ""
		if strings.TrimSpace(project.StyleProfileJSON) != "" {
			var style prompts.StyleProfileDocument
			if json.Unmarshal([]byte(project.StyleProfileJSON), &style) == nil {
				stylePrompt = style.Prompt
			}
		}
		textModel, textConfig, snapshotErr := s.smartFilmTextStageConfig(config, batch)
		assets, assetErr := s.smartFilmStoryboardAssets(run.UserID, run.ProjectID)
		if assetErr != nil {
			continue
		}
		existing, existingErr := s.repo.ProjectUnitShots(run.ProjectID, run.UnitID)
		if existingErr != nil {
			continue
		}
		existingIDs := make([]string, 0, len(existing))
		for _, shot := range existing {
			existingIDs = append(existingIDs, shot.ID)
		}
		items = append(items, SmartFilmStoryboardWorkItem{
			RunID: run.ID, UserID: run.UserID, BatchID: run.BatchID, ScriptID: run.ScriptID,
			ProjectID: run.ProjectID, UnitID: run.UnitID, ProjectName: project.Name, ProjectStyle: stylePrompt,
			ProjectRevision: project.Revision, ScriptTitle: scripts[index].Title, ScriptContent: unit.SourceText,
			TextModel: textModel, TextConfig: textConfig, LogicalModelID: stringValue(textConfig["logicalModelId"]), ConfigurationError: errorText(snapshotErr),
			ShotCount: config.ShotCount, ShotDurationSeconds: config.ShotDurationSeconds,
			ShotDurationsSeconds: config.ShotDurationsSeconds, Assets: assets, ExistingShotIDs: existingIDs,
			StoryboardTaskID: run.StoryboardTaskID, StoryboardStatus: run.StoryboardStatus,
		})
	}
	return items, nil
}

func (s *Service) smartFilmStoryboardAssets(userID, projectID string) ([]SmartFilmStoryboardAsset, error) {
	assets, err := s.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	result := make([]SmartFilmStoryboardAsset, 0, len(assets))
	for _, asset := range assets {
		if asset.Status != model.AssetVersionStatusConfirmed || asset.PrimaryVersionID == "" {
			continue
		}
		definition := map[string]any{}
		if asset.Character != nil {
			definition = asset.Character.Definition
		}
		prompt := strings.TrimSpace(asset.PreviewText)
		if prompt == "" && len(definition) > 0 {
			encoded, _ := json.Marshal(definition)
			prompt = string(encoded)
		}
		if prompt == "" {
			prompt = asset.Title
		}
		result = append(result, SmartFilmStoryboardAsset{
			ID: asset.ID, Title: asset.Title, Category: string(asset.Category), MediaType: asset.MediaType,
			PrimaryVersionID: asset.PrimaryVersionID, Prompt: truncateSmartFilmText(prompt, 1200), Definition: definition,
		})
	}
	return result, nil
}

func (s *Service) smartFilmTextStageConfig(config SmartFilmBatchConfig, batch *model.SmartFilmBatch) (string, map[string]any, error) {
	snapshot, err := s.SmartFilmOrchestrationConfig(batch)
	if err != nil {
		return "", nil, err
	}
	configMap := make(map[string]any, len(snapshot.Text)+2)
	for key, value := range snapshot.Text {
		configMap[key] = value
	}
	modelName := strings.TrimSpace(stringValue(configMap["model"]))
	channelID := strings.TrimSpace(stringValue(configMap["channelId"]))
	if modelName == "" {
		channelID, modelName = splitSmartFilmModelOption(config.DefaultTextModel)
	}
	if modelName == "" {
		return "", nil, errors.New("批次没有可用的文本模型")
	}
	configMap["model"] = modelName
	if channelID != "" {
		configMap["channelId"] = channelID
	}
	modelOption := modelName
	if channelID != "" {
		modelOption = channelID + "::" + modelName
	}
	return modelOption, configMap, nil
}

func splitSmartFilmModelOption(value string) (string, string) {
	value = strings.TrimSpace(value)
	if parts := strings.SplitN(value, "::", 2); len(parts) == 2 {
		return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
	}
	return "", value
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
