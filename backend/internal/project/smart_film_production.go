package project

import (
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"

	"gorm.io/gorm"
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
	if stage == SmartFilmProductionStepAssets && status == SmartFilmProductionStageStatusConfirmed && run.ProjectID != "" && run.UnitID != "" {
		if err := s.repo.MarkSmartFilmAssetStageConfirmed(run.ProjectID, run.UnitID); err != nil {
			return SmartFilmProductionRunView{}, err
		}
		run, err = s.repo.SmartFilmProductionRunForUser(userID, batchID, runID)
		if err != nil {
			return SmartFilmProductionRunView{}, err
		}
	}
	return smartFilmProductionRunView(*run), nil
}

func (s *Service) StartSmartFilmProductionStage(userID, batchID, runID string, req StartSmartFilmProductionStageRequest) (SmartFilmProductionRunView, error) {
	batch, batchErr := s.repo.SmartFilmBatchForUser(userID, batchID)
	if batchErr != nil {
		return SmartFilmProductionRunView{}, batchErr
	}
	if batch.Status == smartFilmBatchStatusArchived {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("批次已归档，不能启动制作")
	}
	stage := strings.TrimSpace(req.Stage)
	if stage != SmartFilmProductionStepAssets && stage != SmartFilmProductionStepStoryboard {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("生产阶段无效")
	}
	run, err := s.repo.SmartFilmProductionRunForUser(userID, batchID, runID)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	if run.Status == SmartFilmProductionRunStatusArchived {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("已归档的生产运行不能启动阶段")
	}
	if run.ControlStatus == SmartFilmProductionControlSkipped || run.Status == SmartFilmProductionRunStatusSkipped {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("已跳过的项目不能启动生产阶段")
	}
	if stage == SmartFilmProductionStepStoryboard {
		if run.AssetStatus != SmartFilmProductionStageStatusReady && run.AssetStatus != SmartFilmProductionStageStatusConfirmed {
			return SmartFilmProductionRunView{}, kernel.BadAuthRequest("资产提取尚未完成，不能生成分镜")
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

func (s *Service) SmartFilmProductionRunForProject(userID, projectID string) (SmartFilmProductionRunView, error) {
	run, err := s.repo.SmartFilmProductionRunForProject(userID, projectID)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	return smartFilmProductionRunView(*run), nil
}

func (s *Service) ControlSmartFilmBatch(userID, batchID string, req SmartFilmBatchControlRequest) (SmartFilmBatchView, error) {
	current, currentErr := s.repo.SmartFilmBatchForUser(userID, batchID)
	if currentErr != nil {
		return SmartFilmBatchView{}, currentErr
	}
	if current.Status == smartFilmBatchStatusArchived {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次已归档，不能继续制作")
	}
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
	batch, batchErr := s.repo.SmartFilmBatchForUser(userID, batchID)
	if batchErr != nil {
		return SmartFilmProductionRunView{}, batchErr
	}
	if batch.Status == smartFilmBatchStatusArchived {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("批次已归档，不能继续制作")
	}
	action := strings.TrimSpace(req.Action)
	run, err := s.repo.SmartFilmProductionRunForUser(userID, batchID, runID)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	if run.Status == SmartFilmProductionRunStatusArchived {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("已归档的生产运行不能继续操作")
	}
	fields := map[string]any{}
	retryReusedTask := false
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
	case "retry", "regenerate":
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
		}
		fields["control_status"] = SmartFilmProductionControlActive
		fields["status"] = SmartFilmProductionRunStatusReady
		fields["current_step"] = stage
		fields["failed_step"] = ""
		fields["error"] = ""
		fields["recoverable_action"] = ""
		fields["worker_lease_owner"] = ""
		fields["worker_lease_until"] = nil
		taskID, taskStatus := "", SmartFilmProductionStageStatusQueued
		if action == "retry" {
			if stage == SmartFilmProductionStepAssets {
				taskID, taskStatus, err = s.smartFilmRetryTask(userID, run.AssetTaskID)
			} else {
				taskID, taskStatus, err = s.smartFilmRetryTask(userID, run.StoryboardTaskID)
			}
		}
		if err != nil {
			return SmartFilmProductionRunView{}, err
		}
		if taskID != "" {
			retryReusedTask = true
			// Reuse a paid result instead of submitting and charging for it again.
			if stage == SmartFilmProductionStepAssets {
				fields["asset_task_id"] = taskID
				fields["asset_status"] = taskStatus
			} else {
				fields["storyboard_task_id"] = taskID
				fields["storyboard_status"] = taskStatus
			}
		} else {
			// Failed or missing tasks must not be polled forever. The new attempt
			// changes the Worker operation identity for the next submission.
			nextAttempt := run.Attempts + 1
			if nextAttempt < 2 {
				nextAttempt = 2
			}
			fields["attempts"] = nextAttempt
			if stage == SmartFilmProductionStepAssets {
				fields["asset_task_id"] = ""
				fields["asset_status"] = SmartFilmProductionStageStatusQueued
			} else {
				fields["storyboard_task_id"] = ""
				fields["storyboard_status"] = SmartFilmProductionStageStatusQueued
			}
		}
	default:
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("项目控制动作无效")
	}
	updated, err := s.repo.ControlSmartFilmProductionRun(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, mapProjectWriteError(err)
	}
	view := smartFilmProductionRunView(*updated)
	view.RetryReusedTask = retryReusedTask
	return view, nil
}

func (s *Service) smartFilmRetryTask(userID, taskID string) (string, string, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "", SmartFilmProductionStageStatusQueued, nil
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", SmartFilmProductionStageStatusQueued, nil
	}
	if err != nil {
		return "", "", err
	}
	switch task.Status {
	case model.TaskStatusQueued:
		return task.ID, SmartFilmProductionStageStatusQueued, nil
	case model.TaskStatusRunning:
		return task.ID, SmartFilmProductionStageStatusRunning, nil
	case model.TaskStatusSucceeded:
		return task.ID, SmartFilmProductionStageStatusQueued, nil
	default:
		return "", SmartFilmProductionStageStatusQueued, nil
	}
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
		scripts, scriptErr := s.smartFilmScripts(batch)
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
		existingAssets, _ := s.smartFilmStoryboardAssetsForBatch(run.UserID, run.ProjectID, "", false, config, project.Name)
		fixedCharacterCount := smartFilmFixedCharacterCount(config)
		skillID, skillVersionID, skillContentHash, skillContext := smartFilmSkillStage(config, SmartFilmSkillStageAssets)
		items = append(items, SmartFilmAssetExtractionWorkItem{
			RunID: run.ID, Attempts: run.Attempts, UserID: run.UserID, BatchID: run.BatchID, ScriptID: run.ScriptID,
			ProjectID: run.ProjectID, UnitID: run.UnitID, ProjectName: project.Name, ProjectStyle: stylePrompt,
			ExistingAssets:      existingAssets,
			FixedCharacterCount: fixedCharacterCount,
			InputAssetRoles:     config.InputAssetRoles, InputAssetNames: config.InputAssetNames,
			ScriptTitle: script.Title, ScriptContent: script.Content,
			TextModel: textModel, TextConfig: textConfig, LogicalModelID: stringValue(textConfig["logicalModelId"]), ConfigurationError: errorText(snapshotErr),
			AssetTaskID: run.AssetTaskID, AssetStatus: run.AssetStatus,
			SkillID: skillID, SkillVersionID: skillVersionID, SkillContentHash: skillContentHash, SkillContext: skillContext,
		})
	}
	return items, nil
}

func smartFilmFixedCharacterCount(config SmartFilmBatchConfig) int {
	names := make(map[string]struct{})
	for assetID, role := range config.InputAssetRoles {
		if strings.TrimSpace(role) != "character" {
			continue
		}
		name := strings.TrimSpace(config.InputAssetNames[assetID])
		switch model.AssetCandidateNameKey(name) {
		case "", "生成图片", "图片", "未命名", "未命名图片", "image", "untitled":
			name = assetID
		}
		names[name] = struct{}{}
	}
	return len(names)
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
		scripts, scriptErr := s.smartFilmScripts(batch)
		if scriptErr != nil {
			continue
		}
		index := smartFilmScriptIndex(scripts, run.ScriptID)
		if index < 0 {
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
		assets, assetErr := s.smartFilmStoryboardAssetsForBatch(run.UserID, run.ProjectID, run.UnitID, true, config, project.Name)
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
		skillID, skillVersionID, skillContentHash, skillContext := smartFilmSkillStage(config, SmartFilmSkillStageStoryboard)
		items = append(items, SmartFilmStoryboardWorkItem{
			RunID: run.ID, Attempts: run.Attempts, UserID: run.UserID, BatchID: run.BatchID, ScriptID: run.ScriptID,
			ProjectID: run.ProjectID, UnitID: run.UnitID, ProjectName: project.Name, ProjectStyle: stylePrompt,
			ProjectRevision: project.Revision, ScriptTitle: scripts[index].Title, ScriptContent: unit.SourceText,
			TextModel: textModel, TextConfig: textConfig, LogicalModelID: stringValue(textConfig["logicalModelId"]), ConfigurationError: errorText(snapshotErr),
			ShotCount: config.ShotCount, ShotDurationSeconds: config.ShotDurationSeconds,
			ShotDurationsSeconds: config.ShotDurationsSeconds, TargetDurationSeconds: config.TargetDurationSeconds,
			Assets: assets, InputAssetRoles: config.InputAssetRoles, InputAssetNames: config.InputAssetNames, ExistingShotIDs: existingIDs,
			StoryboardTaskID: run.StoryboardTaskID, StoryboardStatus: run.StoryboardStatus,
			SkillID: skillID, SkillVersionID: skillVersionID, SkillContentHash: skillContentHash, SkillContext: skillContext,
		})
	}
	return items, nil
}

func (s *Service) smartFilmStoryboardAssets(userID, projectID, unitID string, includePendingCandidates bool) ([]SmartFilmStoryboardAsset, error) {
	return s.smartFilmStoryboardAssetsForBatch(userID, projectID, unitID, includePendingCandidates, SmartFilmBatchConfig{}, "")
}

func (s *Service) smartFilmStoryboardAssetsForBatch(userID, projectID, unitID string, includePendingCandidates bool, config SmartFilmBatchConfig, projectName string) ([]SmartFilmStoryboardAsset, error) {
	assets, err := s.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	var candidates []model.ProjectAssetCandidate
	if includePendingCandidates {
		candidates, err = s.repo.ProjectAssetCandidates(projectID)
		if err != nil {
			return nil, err
		}
	}
	productAlias := smartFilmProductAlias(config, candidates, projectName)
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
		title := asset.Title
		aliases := make([]string, 0, 2)
		inputRole := strings.TrimSpace(config.InputAssetRoles[asset.ID])
		if inputName := smartFilmMeaningfulInputName(config.InputAssetNames[asset.ID]); inputName != "" {
			if !strings.EqualFold(inputName, title) {
				aliases = append(aliases, title)
			}
			title = inputName
		} else if inputRole == "product" && productAlias != "" {
			if !strings.EqualFold(productAlias, title) {
				aliases = append(aliases, title)
			}
			title = productAlias
		}
		result = append(result, SmartFilmStoryboardAsset{
			ID: asset.ID, Title: title, Aliases: aliases, Category: string(asset.Category), InputRole: inputRole, MediaType: asset.MediaType, VisualReference: smartFilmAssetHasVisualReference(asset),
			PrimaryVersionID: asset.PrimaryVersionID, Prompt: truncateSmartFilmText(prompt, 1200), Definition: definition,
		})
	}
	if includePendingCandidates {
		known := make(map[string]struct{}, len(result))
		for _, asset := range result {
			known[assetCandidateIdentity(asset.Title, asset.Category)] = struct{}{}
		}
		for _, candidate := range candidates {
			if candidate.Status != "pending_confirmation" {
				continue
			}
			if strings.TrimSpace(unitID) != "" && candidate.UnitID != unitID {
				continue
			}
			key := assetCandidateIdentity(candidate.Name, string(candidate.Category))
			if _, exists := known[key]; exists {
				continue
			}
			definition := map[string]any{}
			_ = json.Unmarshal([]byte(candidate.DetailsJSON), &definition)
			result = append(result, SmartFilmStoryboardAsset{
				ID: candidate.ID, Title: candidate.Name, Category: string(candidate.Category), MediaType: "text",
				VisualReference: false, Prompt: truncateSmartFilmText(candidatePreviewPrompt(&candidate), 1200), Definition: definition,
			})
			known[key] = struct{}{}
		}
	}
	return result, nil
}

func smartFilmProductAlias(config SmartFilmBatchConfig, candidates []model.ProjectAssetCandidate, projectName string) string {
	names := make(map[string]struct{})
	for assetID, role := range config.InputAssetRoles {
		if strings.TrimSpace(role) != "product" {
			continue
		}
		if name := smartFilmMeaningfulInputName(config.InputAssetNames[assetID]); name != "" {
			names[name] = struct{}{}
		}
	}
	if len(names) == 1 {
		for name := range names {
			return name
		}
	}
	if len(names) > 0 || strings.TrimSpace(projectName) == "" {
		return ""
	}
	projectKey := strings.ToLower(strings.TrimSpace(projectName))
	best := ""
	for _, candidate := range candidates {
		if candidate.Category != model.AssetCategoryProp {
			continue
		}
		name := strings.TrimSpace(candidate.Name)
		if name != "" && strings.Contains(projectKey, strings.ToLower(name)) && len(name) > len(best) {
			best = name
		}
	}
	return best
}

func smartFilmMeaningfulInputName(value string) string {
	name := strings.TrimSpace(value)
	switch model.AssetCandidateNameKey(name) {
	case "", "生成图片", "图片", "未命名", "未命名图片", "image", "untitled", "产品", "道具", "场景", "资产", "人物", "角色":
		return ""
	default:
		return name
	}
}

func assetCandidateIdentity(title, category string) string {
	return strings.ToLower(strings.TrimSpace(category)) + "\x00" + model.AssetCandidateNameKey(title)
}

func smartFilmAssetHasVisualReference(asset AssetSummary) bool {
	if asset.MediaType == "image" && strings.TrimSpace(asset.StorageKey) != "" {
		return true
	}
	if asset.Character == nil {
		return false
	}
	if asset.Character.VisualStatus != "ready" {
		return false
	}
	for _, representation := range asset.Character.Representations {
		if strings.HasPrefix(representation.MediaType, "image") && strings.TrimSpace(representation.ResourceID) != "" {
			return true
		}
	}
	return false
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
