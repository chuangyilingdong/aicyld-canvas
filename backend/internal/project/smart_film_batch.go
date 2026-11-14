package project

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"

	"gorm.io/gorm"
)

const (
	smartFilmBatchStatusDraft              = "draft"
	smartFilmBatchStatusConfirmed          = "confirmed"
	smartFilmBatchStatusPartiallyConfirmed = "partially_confirmed"
	smartFilmScriptLimit                   = 10
	smartFilmInputAssetLimit               = 12
)

func (s *Service) CreateSmartFilmBatch(userID string, req CreateSmartFilmBatchRequest) (SmartFilmBatchView, error) {
	title := strings.TrimSpace(req.Title)
	sourceText := strings.TrimSpace(req.SourceText)
	if title == "" {
		title = sourceText
	}
	if title == "" {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次名称不能为空")
	}
	if sourceText == "" {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请先填写视频想法")
	}
	if len([]rune(sourceText)) > 50000 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("视频想法不能超过 50000 个字符")
	}
	config, err := normalizeSmartFilmBatchConfig(req.Config)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	inputAssetIDs := normalizeSmartFilmInputAssetIDs(req.InputAssetIDs)
	if len(inputAssetIDs) > smartFilmInputAssetLimit {
		return SmartFilmBatchView{}, kernel.BadAuthRequest(fmt.Sprintf("产品参考图最多 %d 张", smartFilmInputAssetLimit))
	}
	now := time.Now()
	batch := model.SmartFilmBatch{
		ID: kernel.NewID(), UserID: userID, Title: truncateSmartFilmText(title, 240), SourceText: sourceText,
		InputAssetIDsJSON: mustJSON(inputAssetIDs), ConfigJSON: mustJSON(config), ScriptsJSON: "[]",
		Status: smartFilmBatchStatusDraft, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateSmartFilmBatch(&batch); err != nil {
		return SmartFilmBatchView{}, err
	}
	return s.smartFilmBatchResponse(batch)
}

func (s *Service) SmartFilmBatch(userID, batchID string) (SmartFilmBatchView, error) {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	return s.smartFilmBatchResponse(*batch)
}

func (s *Service) SaveSmartFilmBatchScripts(userID, batchID string, req SaveSmartFilmBatchScriptsRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再保存剧本")
	}
	if len(req.Scripts) == 0 || len(req.Scripts) > smartFilmScriptLimit {
		return SmartFilmBatchView{}, kernel.BadAuthRequest(fmt.Sprintf("每次需要保存 1-%d 条剧本", smartFilmScriptLimit))
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	existing, err := smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	byID := make(map[string]SmartFilmScript, len(existing))
	for _, script := range existing {
		byID[script.ID] = script
	}
	now := time.Now()
	scripts := make([]SmartFilmScript, 0, len(req.Scripts))
	seen := make(map[string]struct{}, len(req.Scripts))
	for _, input := range req.Scripts {
		title := strings.TrimSpace(input.Title)
		content := strings.TrimSpace(input.Content)
		if title == "" || content == "" {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("每条剧本都需要标题和正文")
		}
		if len([]rune(content)) > 30000 {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("单条剧本不能超过 30000 个字符")
		}
		id := strings.TrimSpace(input.ID)
		if id == "" {
			id = kernel.NewID()
		}
		if _, ok := seen[id]; ok {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本 ID 重复")
		}
		seen[id] = struct{}{}
		previous, ok := byID[id]
		script := SmartFilmScript{
			ID: id, Title: truncateSmartFilmText(title, 240), Content: content, Status: SmartFilmScriptStatusDraft,
			TaskID: strings.TrimSpace(input.TaskID), CreatedAt: now, UpdatedAt: now,
		}
		if ok {
			script.ProjectID = previous.ProjectID
			script.UnitID = previous.UnitID
			script.CreatedAt = previous.CreatedAt
			if script.TaskID == "" {
				script.TaskID = previous.TaskID
			}
		}
		if script.ProjectID != "" {
			script.Status = previous.Status
			script.Error = previous.Error
		}
		scripts = append(scripts, script)
	}
	updated, err := s.repo.UpdateSmartFilmBatch(userID, batchID, req.ExpectedRevision, map[string]any{
		"scripts_json": mustJSON(scripts),
		"status":       smartFilmBatchStatus(scripts),
	})
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*updated)
}

func (s *Service) UpdateSmartFilmBatchScript(userID, batchID, scriptID string, req UpdateSmartFilmBatchScriptRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再修改剧本")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if batch.Revision != req.ExpectedRevision {
		return SmartFilmBatchView{}, kernel.WrapAppError(kernel.CodeConflict, "批次已发生变化，请刷新后重试", nil)
	}
	scripts, err := smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	index := smartFilmScriptIndex(scripts, scriptID)
	if index < 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本不存在，请刷新后重试")
	}
	title := strings.TrimSpace(req.Title)
	content := strings.TrimSpace(req.Content)
	if title == "" || content == "" {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本标题和正文不能为空")
	}
	if len([]rune(content)) > 30000 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("单条剧本不能超过 30000 个字符")
	}
	nextStatus := strings.TrimSpace(req.Status)
	if nextStatus == "" {
		nextStatus = scripts[index].Status
		if scripts[index].ProjectID == "" {
			nextStatus = SmartFilmScriptStatusDraft
		}
	}
	if !validSmartFilmScriptStatus(nextStatus) {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本状态无效")
	}
	scripts[index].Title = truncateSmartFilmText(title, 240)
	scripts[index].Content = content
	scripts[index].Status = nextStatus
	scripts[index].Error = ""
	if taskID := strings.TrimSpace(req.TaskID); taskID != "" {
		scripts[index].TaskID = taskID
	}
	scripts[index].UpdatedAt = time.Now()
	updated, err := s.repo.UpdateSmartFilmBatch(userID, batchID, req.ExpectedRevision, map[string]any{
		"scripts_json": mustJSON(scripts),
		"status":       smartFilmBatchStatus(scripts),
	})
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*updated)
}

func (s *Service) DeleteSmartFilmBatchScript(userID, batchID, scriptID string, expectedRevision int64) (SmartFilmBatchView, error) {
	if expectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再删除剧本")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	scripts, err := smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	next := make([]SmartFilmScript, 0, len(scripts))
	found := false
	for _, script := range scripts {
		if script.ID == scriptID {
			found = true
			if script.ProjectID != "" {
				return SmartFilmBatchView{}, kernel.BadAuthRequest("已经创建视频项目的剧本不能删除")
			}
			continue
		}
		next = append(next, script)
	}
	if !found {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("剧本不存在，请刷新后重试")
	}
	updated, err := s.repo.UpdateSmartFilmBatch(userID, batchID, expectedRevision, map[string]any{
		"scripts_json": mustJSON(next),
		"status":       smartFilmBatchStatus(next),
	})
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*updated)
}

func (s *Service) ConfirmSmartFilmBatchScripts(userID, batchID string, req ConfirmSmartFilmBatchScriptsRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再确认剧本")
	}
	selected := normalizeSmartFilmInputAssetIDs(req.ScriptIDs)
	if len(selected) == 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请至少选择一条剧本")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	scripts, err := smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	config, err := smartFilmBatchConfig(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	inputAssetIDs, err := smartFilmInputAssetIDs(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	selectedSet := make(map[string]struct{}, len(selected))
	for _, id := range selected {
		selectedSet[id] = struct{}{}
	}
	selectedIndexes := make([]int, 0, len(selected))
	for index := range scripts {
		if _, ok := selectedSet[scripts[index].ID]; ok {
			selectedIndexes = append(selectedIndexes, index)
		}
	}
	if len(selectedIndexes) == 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("选中的剧本不存在，请刷新后重试")
	}
	existingRuns, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	runsByScript := make(map[string]model.SmartFilmProductionRun, len(existingRuns))
	for _, run := range existingRuns {
		runsByScript[run.ScriptID] = run
	}
	allReady := true
	for _, index := range selectedIndexes {
		script := scripts[index]
		run, ok := runsByScript[script.ID]
		if !ok || run.Status != SmartFilmProductionRunStatusReady || run.ProjectID == "" || run.UnitID == "" ||
			script.ProjectID != run.ProjectID || script.UnitID != run.UnitID {
			allReady = false
			break
		}
	}
	if allReady {
		return s.smartFilmBatchResponse(*batch)
	}
	if batch.Revision != req.ExpectedRevision {
		return SmartFilmBatchView{}, kernel.WrapAppError(kernel.CodeConflict, "批次已发生变化，请刷新后重试", nil)
	}
	if s.workflows != nil {
		if err := s.workflows.EnsureBuiltinTemplate(); err != nil {
			return SmartFilmBatchView{}, err
		}
	}

	runs := make(map[string]*model.SmartFilmProductionRun, len(selectedIndexes))
	for _, index := range selectedIndexes {
		script := scripts[index]
		now := time.Now()
		run := &model.SmartFilmProductionRun{
			ID: kernel.NewID(), UserID: userID, BatchID: batchID, ScriptID: script.ID,
			IdempotencyKey: smartFilmProductionRunKey(batchID, script.ID, script.Title, script.Content),
			Status:         SmartFilmProductionRunStatusPending, CurrentStep: SmartFilmProductionStepProject,
			ProjectID: script.ProjectID, UnitID: script.UnitID, ResourceSnapshotJSON: "{}",
			AssetStatus: SmartFilmProductionStageStatusWaiting, StoryboardStatus: SmartFilmProductionStageStatusWaiting,
			Revision: 1, CreatedAt: now, UpdatedAt: now,
		}
		if err := s.repo.PrepareSmartFilmProductionRun(run); err != nil {
			return SmartFilmBatchView{}, err
		}
		runs[script.ID] = run
	}
	allReady = true
	for _, index := range selectedIndexes {
		script := scripts[index]
		run := runs[script.ID]
		if run == nil || run.Status != SmartFilmProductionRunStatusReady || run.ProjectID == "" || run.UnitID == "" {
			allReady = false
			break
		}
	}
	if allReady {
		latest, latestErr := s.repo.SmartFilmBatchForUser(userID, batchID)
		if latestErr != nil {
			return SmartFilmBatchView{}, latestErr
		}
		return s.smartFilmBatchResponse(*latest)
	}

	var updated *model.SmartFilmBatch
	activeScriptID := ""
	activeStep := ""
	txErr := s.repo.DB().Transaction(func(tx *gorm.DB) error {
		txRepo := s.repo.WithTx(tx)
		txService := &Service{repo: txRepo, workflows: smartFilmTransactionWorkflows{
			original: s.workflows,
			tx:       &Service{repo: txRepo},
		}}
		now := time.Now()
		for _, index := range selectedIndexes {
			script := &scripts[index]
			run := runs[script.ID]
			activeScriptID = script.ID

			if run.Status == SmartFilmProductionRunStatusReady && run.ProjectID != "" && run.UnitID != "" {
				activeStep = SmartFilmProductionStepProject
				if _, err := txService.Active(userID, run.ProjectID); err != nil {
					return err
				}
				activeStep = SmartFilmProductionStepUnit
				if _, err := txRepo.ProjectUnit(run.ProjectID, run.UnitID); err != nil {
					return err
				}
				script.ProjectID = run.ProjectID
				script.UnitID = run.UnitID
				if script.Status != SmartFilmScriptStatusStoryboardReady {
					script.Status = SmartFilmScriptStatusProjectCreated
				}
				script.Error = ""
				script.UpdatedAt = now
				continue
			}

			projectID := strings.TrimSpace(script.ProjectID)
			if projectID == "" {
				activeStep = SmartFilmProductionStepProject
				project, createErr := txService.CreateProject(userID, CreateProjectRequest{
					Name: smartFilmProjectName(*script), Type: "smart-film", AspectRatio: config.AspectRatio,
					SourceType: "text", Description: script.Content, StylePresetID: config.StylePresetID,
					StyleProfileJSON: config.StyleProfileJSON, DefaultImageModel: strings.TrimSpace(config.DefaultImageModel),
					DefaultVideoModel: strings.TrimSpace(config.DefaultVideoModel),
				})
				if createErr != nil {
					return createErr
				}
				projectID = project.ID
			} else {
				activeStep = SmartFilmProductionStepProject
				if _, err := txService.Active(userID, projectID); err != nil {
					return err
				}
			}

			unitID := strings.TrimSpace(script.UnitID)
			if unitID != "" {
				activeStep = SmartFilmProductionStepUnit
				if _, err := txRepo.ProjectUnit(projectID, unitID); errors.Is(err, gorm.ErrRecordNotFound) {
					unitID = ""
				} else if err != nil {
					return err
				}
			}
			if unitID == "" {
				activeStep = SmartFilmProductionStepUnit
				units, err := txRepo.ProjectUnits(projectID)
				if err != nil {
					return err
				}
				switch len(units) {
				case 0:
					unit, createErr := txService.CreateProjectUnit(userID, projectID, CreateProjectUnitRequest{
						Kind: "chapter", Title: script.Title, SourceText: script.Content, Position: 0,
					})
					if createErr != nil {
						return createErr
					}
					unitID = unit.ID
				case 1:
					unitID = units[0].ID
				default:
					return kernel.BadAuthRequest("项目已有多个章节，无法自动恢复产品图关联，请先清理多余章节")
				}
			}

			linkedAssetIDs := make([]string, 0, len(inputAssetIDs))
			for _, assetID := range inputAssetIDs {
				activeStep = SmartFilmProductionStepAssetLink
				if _, linkErr := txService.LinkProjectAsset(userID, projectID, LinkProjectAssetRequest{
					AssetID: assetID, Category: string(model.AssetCategoryProp), Source: AssetSourceUploaded, Title: "产品参考",
				}); linkErr != nil {
					return linkErr
				}
				linkedAssetIDs = append(linkedAssetIDs, assetID)
			}

			run.ProjectID = projectID
			run.UnitID = unitID
			run.Status = SmartFilmProductionRunStatusReady
			run.CurrentStep = SmartFilmProductionStepCompleted
			run.FailedStep = ""
			run.Error = ""
			run.RecoverableAction = ""
			run.Attempts++
			run.ResourceSnapshotJSON = mustJSON(SmartFilmProductionResources{ProjectID: projectID, UnitID: unitID, LinkedAssetIDs: linkedAssetIDs})
			run.UpdatedAt = now
			activeStep = "run_checkpoint"
			result := tx.Model(&model.SmartFilmProductionRun{}).
				Where("id = ? AND user_id = ?", run.ID, userID).
				Updates(map[string]any{
					"status": run.Status, "current_step": run.CurrentStep, "project_id": run.ProjectID,
					"unit_id": run.UnitID, "resource_snapshot_json": run.ResourceSnapshotJSON,
					"failed_step": "", "error": "", "recoverable_action": "", "attempts": run.Attempts, "updated_at": now,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return fmt.Errorf("smart film production run checkpoint missing")
			}
			script.ProjectID = projectID
			script.UnitID = unitID
			if script.Status != SmartFilmScriptStatusStoryboardReady {
				script.Status = SmartFilmScriptStatusProjectCreated
			}
			script.Error = ""
			script.UpdatedAt = now
		}

		activeStep = SmartFilmProductionStepBatch
		var updateErr error
		updated, updateErr = txRepo.UpdateSmartFilmBatch(userID, batchID, req.ExpectedRevision, map[string]any{
			"scripts_json": mustJSON(scripts),
			"status":       smartFilmBatchStatus(scripts),
		})
		if updateErr != nil {
			return mapProjectWriteError(updateErr)
		}
		return nil
	})
	if txErr != nil {
		if activeScriptID != "" && !IsConflict(txErr) {
			if run := runs[activeScriptID]; run != nil {
				_ = s.repo.RecordSmartFilmProductionRunFailure(userID, run.IdempotencyKey, activeStep, txErr.Error())
			}
		}
		return SmartFilmBatchView{}, txErr
	}
	return s.smartFilmBatchResponse(*updated)
}

func (s *Service) CheckpointSmartFilmProductionRun(userID, batchID, runID string, req SmartFilmProductionStageCheckpointRequest) (SmartFilmProductionRunView, error) {
	stage := strings.TrimSpace(req.Stage)
	status := strings.TrimSpace(req.Status)
	if stage != SmartFilmProductionStepAssets && stage != SmartFilmProductionStepStoryboard {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("生产阶段无效")
	}
	switch status {
	case SmartFilmProductionStageStatusPending, SmartFilmProductionStageStatusWaiting, SmartFilmProductionStageStatusQueued, SmartFilmProductionStageStatusRunning, SmartFilmProductionStageStatusReady, SmartFilmProductionStageStatusAttention:
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
		if stage == SmartFilmProductionStepAssets {
			fields["recoverable_action"] = SmartFilmProductionActionRetryAssets
		} else {
			fields["recoverable_action"] = SmartFilmProductionActionRetryStoryboard
		}
	} else {
		fields["error"] = ""
		fields["recoverable_action"] = ""
	}
	run, err := s.repo.UpdateSmartFilmProductionRunStage(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	return smartFilmProductionRunView(*run), nil
}

func (s *Service) StartSmartFilmProductionStage(userID, batchID, runID string, req StartSmartFilmProductionStageRequest) (SmartFilmProductionRunView, error) {
	stage := strings.TrimSpace(req.Stage)
	if stage != SmartFilmProductionStepAssets {
		return SmartFilmProductionRunView{}, kernel.BadAuthRequest("当前仅支持后台资产提取阶段")
	}
	fields := map[string]any{
		"current_step": stage, "status": SmartFilmProductionRunStatusReady,
		"error": "", "recoverable_action": "", "worker_lease_owner": "", "worker_lease_until": nil,
	}
	fields["asset_status"] = SmartFilmProductionStageStatusQueued
	fields["asset_task_id"] = ""
	run, err := s.repo.UpdateSmartFilmProductionRunStage(userID, batchID, runID, fields)
	if err != nil {
		return SmartFilmProductionRunView{}, err
	}
	return smartFilmProductionRunView(*run), nil
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
		items = append(items, SmartFilmAssetExtractionWorkItem{
			RunID: run.ID, UserID: run.UserID, BatchID: run.BatchID, ScriptID: run.ScriptID,
			ProjectID: run.ProjectID, UnitID: run.UnitID, ProjectName: project.Name, ProjectStyle: stylePrompt,
			ScriptTitle: script.Title, ScriptContent: script.Content,
			TextModel: config.DefaultTextModel, AssetTaskID: run.AssetTaskID, AssetStatus: run.AssetStatus,
		})
	}
	return items, nil
}

func (s *Service) EnsureSmartFilmVideoTaskAllowed(userID, projectID string, input map[string]any) error {
	if strings.TrimSpace(projectID) == "" || input == nil {
		return nil
	}
	if mode, _ := input["mode"].(string); mode != "video" {
		return nil
	}
	project, err := s.repo.ProjectForUser(userID, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if project.Type != "smart-film" && project.Type != "smart-film-auto" {
		return nil
	}
	metadata, _ := input["metadata"].(map[string]any)
	shotID, _ := metadata["shotId"].(string)
	if strings.TrimSpace(shotID) == "" {
		return kernel.BadAuthRequest("生成镜头视频前必须指定已确认的分镜提示词")
	}
	shot, err := s.repo.ShotForProject(projectID, shotID)
	if err != nil {
		return err
	}
	if shot.Status != "confirmed" {
		return kernel.BadAuthRequest("当前镜头的分镜提示词尚未确认，不能生成视频")
	}
	return nil
}

func smartFilmBatchView(batch model.SmartFilmBatch) (SmartFilmBatchView, error) {
	inputAssetIDs, err := smartFilmInputAssetIDs(&batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	config, err := smartFilmBatchConfig(&batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	scripts, err := smartFilmScripts(&batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	return SmartFilmBatchView{
		ID: batch.ID, Title: batch.Title, SourceText: batch.SourceText, InputAssetIDs: inputAssetIDs,
		Config: config, Scripts: scripts, ProductionRuns: []SmartFilmProductionRunView{}, Status: batch.Status, Revision: batch.Revision,
		CreatedAt: batch.CreatedAt, UpdatedAt: batch.UpdatedAt,
	}, nil
}

type smartFilmTransactionWorkflows struct {
	original Workflows
	tx       *Service
}

func (w smartFilmTransactionWorkflows) EnsureBuiltinTemplate() error { return nil }

func (w smartFilmTransactionWorkflows) PrepareDefault(projectID string) (WorkflowSeed, error) {
	if w.original == nil {
		return w.tx.PrepareDefaultWorkflow(projectID)
	}
	if _, builtin := w.original.(builtinWorkflows); builtin {
		return w.tx.PrepareDefaultWorkflow(projectID)
	}
	return w.original.PrepareDefault(projectID)
}

func (s *Service) smartFilmBatchResponse(batch model.SmartFilmBatch) (SmartFilmBatchView, error) {
	view, err := smartFilmBatchView(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(batch.UserID, batch.ID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	view.ProductionRuns = make([]SmartFilmProductionRunView, 0, len(runs))
	for _, run := range runs {
		view.ProductionRuns = append(view.ProductionRuns, smartFilmProductionRunView(run))
	}
	return view, nil
}

func smartFilmProductionRunView(run model.SmartFilmProductionRun) SmartFilmProductionRunView {
	resources := SmartFilmProductionResources{ProjectID: run.ProjectID, UnitID: run.UnitID, LinkedAssetIDs: []string{}}
	if strings.TrimSpace(run.ResourceSnapshotJSON) != "" {
		_ = json.Unmarshal([]byte(run.ResourceSnapshotJSON), &resources)
	}
	if resources.LinkedAssetIDs == nil {
		resources.LinkedAssetIDs = []string{}
	}
	return SmartFilmProductionRunView{
		ID: run.ID, BatchID: run.BatchID, ScriptID: run.ScriptID, IdempotencyKey: run.IdempotencyKey,
		Status: run.Status, CurrentStep: run.CurrentStep,
		Resources: resources, FailedStep: run.FailedStep, Error: run.Error,
		RecoverableAction: run.RecoverableAction, AssetStatus: run.AssetStatus, AssetTaskID: run.AssetTaskID,
		AssetCount: run.AssetCount, StoryboardStatus: run.StoryboardStatus, StoryboardTaskID: run.StoryboardTaskID,
		StoryboardShotCount: run.StoryboardShotCount, Attempts: run.Attempts, Revision: run.Revision,
		CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt,
	}
}

func smartFilmProductionRunKey(batchID, scriptID, title, content string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{batchID, scriptID, title, content}, "\x00")))
	return "smart-film-confirm:" + hex.EncodeToString(sum[:])
}

func smartFilmBatchConfig(batch *model.SmartFilmBatch) (SmartFilmBatchConfig, error) {
	config := SmartFilmBatchConfig{}
	if strings.TrimSpace(batch.ConfigJSON) != "" {
		if err := json.Unmarshal([]byte(batch.ConfigJSON), &config); err != nil {
			return SmartFilmBatchConfig{}, err
		}
	}
	return normalizeSmartFilmBatchConfig(config)
}

func normalizeSmartFilmBatchConfig(config SmartFilmBatchConfig) (SmartFilmBatchConfig, error) {
	config.AspectRatio = strings.TrimSpace(config.AspectRatio)
	if config.AspectRatio == "" {
		config.AspectRatio = "9:16"
	}
	if config.ScriptCount <= 0 {
		config.ScriptCount = 3
	}
	if config.ScriptCount > smartFilmScriptLimit {
		return SmartFilmBatchConfig{}, kernel.BadAuthRequest(fmt.Sprintf("一次最多生成 %d 条剧本", smartFilmScriptLimit))
	}
	if config.ShotCount <= 0 {
		config.ShotCount = 6
	}
	if config.ShotCount > 200 {
		return SmartFilmBatchConfig{}, kernel.BadAuthRequest("分镜数量不能超过 200")
	}
	if config.ShotDurationSeconds <= 0 {
		config.ShotDurationSeconds = 5
	}
	if config.ShotDurationSeconds > 60 {
		return SmartFilmBatchConfig{}, kernel.BadAuthRequest("单镜时长不能超过 60 秒")
	}
	durations := make([]float64, 0, len(config.ShotDurationsSeconds))
	for _, duration := range config.ShotDurationsSeconds {
		if duration <= 0 || duration > 60 {
			return SmartFilmBatchConfig{}, kernel.BadAuthRequest("逐镜时长必须在 1–60 秒之间")
		}
		durations = append(durations, duration)
	}
	config.ShotDurationsSeconds = durations
	return config, nil
}

func smartFilmScripts(batch *model.SmartFilmBatch) ([]SmartFilmScript, error) {
	if strings.TrimSpace(batch.ScriptsJSON) == "" {
		return []SmartFilmScript{}, nil
	}
	var scripts []SmartFilmScript
	if err := json.Unmarshal([]byte(batch.ScriptsJSON), &scripts); err != nil {
		return nil, err
	}
	if scripts == nil {
		scripts = []SmartFilmScript{}
	}
	return scripts, nil
}

func smartFilmInputAssetIDs(batch *model.SmartFilmBatch) ([]string, error) {
	if strings.TrimSpace(batch.InputAssetIDsJSON) == "" {
		return []string{}, nil
	}
	var ids []string
	if err := json.Unmarshal([]byte(batch.InputAssetIDsJSON), &ids); err != nil {
		return nil, err
	}
	return normalizeSmartFilmInputAssetIDs(ids), nil
}

func normalizeSmartFilmInputAssetIDs(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func smartFilmScriptIndex(scripts []SmartFilmScript, scriptID string) int {
	for index := range scripts {
		if scripts[index].ID == scriptID {
			return index
		}
	}
	return -1
}

func smartFilmBatchStatus(scripts []SmartFilmScript) string {
	if len(scripts) == 0 {
		return smartFilmBatchStatusDraft
	}
	projectCount := 0
	for _, script := range scripts {
		if script.ProjectID != "" {
			projectCount++
		}
	}
	if projectCount == 0 {
		return smartFilmBatchStatusDraft
	}
	if projectCount == len(scripts) {
		return smartFilmBatchStatusConfirmed
	}
	return smartFilmBatchStatusPartiallyConfirmed
}

func validSmartFilmScriptStatus(status string) bool {
	switch status {
	case SmartFilmScriptStatusDraft, SmartFilmScriptStatusProjectCreated, SmartFilmScriptStatusAssetsExtracted, SmartFilmScriptStatusStoryboardReady, SmartFilmScriptStatusNeedsAttention, SmartFilmScriptStatusFailed:
		return true
	default:
		return false
	}
}

func smartFilmProjectName(script SmartFilmScript) string {
	suffix := script.ID
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return truncateSmartFilmText(script.Title, 220) + " · " + suffix
}

func truncateSmartFilmText(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit])
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "[]"
	}
	return string(data)
}
