package project

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
)

func (s *Service) UpdateSmartFilmBatchBudget(userID, batchID string, req UpdateSmartFilmBatchBudgetRequest) (SmartFilmBatchView, error) {
	current, currentErr := s.repo.SmartFilmBatchForUser(userID, batchID)
	if currentErr != nil {
		return SmartFilmBatchView{}, currentErr
	}
	if current.Status == smartFilmBatchStatusArchived {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次已归档，不能修改预算")
	}
	if req.BudgetPoints < 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次预算不能为负数")
	}
	committed, err := s.repo.SmartFilmBatchCommittedPoints(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if req.BudgetPoints > 0 && req.BudgetPoints < committed {
		return SmartFilmBatchView{}, kernel.BadAuthRequest(fmt.Sprintf("批次预算不能低于已占用 %d 积分", committed))
	}
	batch, err := s.repo.SetSmartFilmBatchBudget(userID, batchID, req.BudgetPoints)
	if err != nil {
		if errors.Is(err, repository.ErrSmartFilmBudgetBelowUsed) {
			return SmartFilmBatchView{}, kernel.BadAuthRequest(fmt.Sprintf("批次预算不能低于已占用 %d 积分", committed))
		}
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*batch)
}

func (s *Service) SmartFilmBatchCost(userID, batchID string) (SmartFilmBatchCostView, error) {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	config, err := smartFilmBatchConfig(batch)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	return s.smartFilmBatchCostView(userID, batch, config, runs, "")
}

func (s *Service) smartFilmBatchCostView(userID string, batch *model.SmartFilmBatch, config SmartFilmBatchConfig, runs []model.SmartFilmProductionRun, scriptPrompt string) (SmartFilmBatchCostView, error) {
	committed := 0
	var err error
	if strings.TrimSpace(batch.ID) != "" {
		committed, err = s.repo.SmartFilmBatchCommittedPoints(userID, batch.ID)
		if err != nil {
			return SmartFilmBatchCostView{}, err
		}
	}
	if batch.Status == smartFilmBatchStatusArchived {
		return SmartFilmBatchCostView{BudgetPoints: batch.BudgetPoints, CommittedPoints: committed, TotalPoints: committed, Items: []SmartFilmBatchCostItem{}}, nil
	}
	items := make([]SmartFilmBatchCostItem, 0)
	enabled := false
	balance := 0
	balanceSet := false
	addQuote := func(key, label, stage string, count int, req localtask.CreateRequest) error {
		if count <= 0 || s.quoteTask == nil {
			return nil
		}
		quote, quoteErr := s.quoteTask(userID, req)
		if quoteErr != nil {
			return quoteErr
		}
		if quote == nil {
			return nil
		}
		if quote.Enabled {
			enabled = true
			if !balanceSet || quote.Balance < balance {
				balance = quote.Balance
				balanceSet = true
			}
		}
		items = append(items, SmartFilmBatchCostItem{Key: key, Label: label, Stage: stage, Count: count, Points: quote.Points * count, Enabled: quote.Enabled})
		return nil
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	textModel, textConfig, textErr := s.smartFilmTextStageConfig(config, batch)
	if textErr != nil {
		return SmartFilmBatchCostView{}, textErr
	}
	textModelName := modelNameFromOption(textModel)
	workRows := []repository.SmartFilmBatchTaskWorkCount{}
	if strings.TrimSpace(batch.ID) != "" {
		workRows, err = s.repo.SmartFilmBatchTaskWorkCounts(userID, batch.ID)
		if err != nil {
			return SmartFilmBatchCostView{}, err
		}
	}
	workUsage := mapSmartFilmTaskWorkUsage(workRows)
	if len(scripts) == 0 && !workUsage[""]["script"].hasAny() {
		quotePrompt := strings.TrimSpace(scriptPrompt)
		if quotePrompt == "" {
			quotePrompt = batch.SourceText
		}
		if err := addQuote("script", "多剧本生成", "script", 1, localtask.CreateRequest{
			Type: "canvas_text", Operation: "text", Prompt: quotePrompt, Model: textModelName,
			LogicalModelID: stringValue(textConfig["logicalModelId"]),
			Input: map[string]any{
				"mode": "text", "prompt": quotePrompt, "config": textConfig,
				"metadata": map[string]any{"source": "smart-film-batch-script", "batchId": batch.ID, "scriptCount": config.ScriptCount, "skillSnapshot": config.SkillSnapshot},
			},
		}); err != nil {
			return SmartFilmBatchCostView{}, err
		}
	}

	if config.ProductionMode == "" {
		return smartFilmBatchCostSummary(batch, committed, items, enabled, balance), nil
	}

	plannedScripts := config.ScriptCount
	if len(scripts) > 0 {
		plannedScripts = len(scripts)
	}
	if plannedScripts <= 0 {
		plannedScripts = 1
	}
	actualRuns := make([]model.SmartFilmProductionRun, 0, len(runs))
	for _, run := range runs {
		if run.ProjectID == "" || run.UnitID == "" {
			continue
		}
		actualRuns = append(actualRuns, run)
		if run.Status == SmartFilmProductionRunStatusSkipped || run.ControlStatus == SmartFilmProductionControlSkipped {
			continue
		}
		project, projectErr := s.repo.ProjectForUser(userID, run.ProjectID)
		if projectErr != nil {
			continue
		}
		if run.AssetStatus != SmartFilmProductionStageStatusReady && run.AssetStatus != SmartFilmProductionStageStatusConfirmed && !workUsage[run.ProjectID]["assets"].hasAny() {
			if err := addQuote("assets:"+run.ID, "资产提取 · "+project.Name, "assets", 1, localtask.CreateRequest{
				ProjectID: run.ProjectID, Type: "canvas_text", Operation: "chapter_character_breakdown",
				Prompt: "从剧本提取角色、场景和道具资产", Model: textModelName,
				LogicalModelID: stringValue(textConfig["logicalModelId"]),
				Input: map[string]any{"mode": "text", "prompt": "从剧本提取角色、场景和道具资产", "config": textConfig,
					"metadata": map[string]any{"projectId": run.ProjectID, "batchId": batch.ID, "source": "smart-film-batch-worker", "skillSnapshot": config.SkillSnapshot}},
			}); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
		if run.StoryboardStatus != SmartFilmProductionStageStatusReady && run.StoryboardStatus != SmartFilmProductionStageStatusConfirmed && !workUsage[run.ProjectID]["storyboard"].hasAny() {
			textReq := localtask.CreateRequest{
				ProjectID: run.ProjectID, Type: "canvas_text", Operation: "storyboard", Prompt: "短剧分镜规划",
				Model: textModelName, LogicalModelID: stringValue(textConfig["logicalModelId"]),
				Input: map[string]any{"mode": "text", "prompt": "短剧分镜规划", "config": textConfig,
					"metadata": map[string]any{"domainProjectId": run.ProjectID, "batchId": batch.ID, "chapterId": run.UnitID, "source": "smart-film-batch-worker", "skillSnapshot": config.SkillSnapshot}},
			}
			if err := addQuote("storyboard:"+run.ID, "分镜生成 · "+project.Name, "storyboard", 1, textReq); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
		if workUsage[run.ProjectID] == nil {
			workUsage[run.ProjectID] = make(map[string]smartFilmTaskStageUsage)
		}
		shots, shotsErr := s.mergeSmartFilmReadyWork(run.ProjectID, run.UnitID, workUsage[run.ProjectID])
		if shotsErr != nil {
			return SmartFilmBatchCostView{}, shotsErr
		}
		shotCount := config.ShotCount
		if len(shots) > 0 {
			shotCount = len(shots)
		}
		if shotCount <= 0 {
			shotCount = 1
		}
		imageCount := remainingSmartFilmWork(shotCount, workUsage[run.ProjectID]["image"])
		imageModel, imageConfig, imageErr := s.smartFilmImageStageConfig(config, batch)
		if imageErr == nil && imageCount > 0 {
			imageReq := localtask.CreateRequest{
				ProjectID: run.ProjectID, Type: "canvas_image", Operation: "image", Prompt: "镜头分镜图",
				Model: modelNameFromOption(imageModel), LogicalModelID: stringValue(imageConfig["logicalModelId"]),
				Input: map[string]any{"mode": "image", "prompt": "镜头分镜图", "config": imageConfig,
					"metadata": map[string]any{"source": "short-drama-workflow", "batchId": batch.ID, "artifactType": "storyboard"}},
			}
			if err := addQuote("image:"+run.ID, "分镜图 · "+project.Name, "image", imageCount, imageReq); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
		videoModel, videoConfig, videoErr := s.smartFilmVideoStageConfig(config, batch)
		if videoErr == nil {
			durations := smartFilmRemainingVideoDurations(config, shots, workUsage[run.ProjectID]["video"])
			videoLabel := "镜头视频 · " + project.Name
			if config.ProductionMode == SmartFilmProductionModeSmart {
				durations = []smartFilmDurationCount{{Seconds: config.TargetDurationSeconds, Count: remainingSmartFilmWork(1, workUsage[run.ProjectID]["whole_video"])}}
				videoLabel = "智能整片 · " + project.Name
			}
			resolvedAudioMode := smartFilmResolvedAudioMode(config)
			if resolvedAudioMode == SmartFilmAudioModeNative {
				videoConfig["videoGenerateAudio"] = "true"
			} else {
				videoConfig["videoGenerateAudio"] = "false"
			}
			videoReq := localtask.CreateRequest{
				Type: "canvas_video", Operation: "image_to_video", Prompt: "镜头视频", Model: modelNameFromOption(videoModel),
				LogicalModelID: stringValue(videoConfig["logicalModelId"]),
				Input: map[string]any{"mode": "video", "prompt": "镜头视频", "config": videoConfig,
					"metadata": map[string]any{"source": "short-drama-workflow", "batchId": batch.ID, "videoEditOperation": "image_to_video"}},
			}
			for _, duration := range durations {
				videoConfig["videoSeconds"] = fmt.Sprintf("%.0f", duration.Seconds)
				if err := addQuote(fmt.Sprintf("video:%s:%g", run.ID, duration.Seconds), videoLabel, "video", duration.Count, videoReq); err != nil {
					return SmartFilmBatchCostView{}, err
				}
			}
			if resolvedAudioMode == SmartFilmAudioModeSeparate {
				narrationCount := remainingSmartFilmWork(shotCount, workUsage[run.ProjectID]["narration"])
				musicCount := 1
				if workUsage[run.ProjectID]["bgm"].hasAny() {
					musicCount = 0
				}
				if narrationCount == 0 && musicCount == 0 {
					continue
				}
				audioConfigured, configureErr := s.smartFilmAudioConfigured(batch)
				if configureErr != nil {
					return SmartFilmBatchCostView{}, configureErr
				}
				if audioConfigured {
					if err := s.addSmartFilmAudioCosts(userID, batch, project.Name, narrationCount, musicCount, &items, &enabled, &balance, &balanceSet); err != nil {
						return SmartFilmBatchCostView{}, err
					}
				} else if config.AudioMode == SmartFilmAudioModeSeparate {
					return SmartFilmBatchCostView{}, errors.New("批次缺少可用的旁白或 BGM 模型")
				}
			}
		}
	}

	plannedMissing := plannedScripts - len(actualRuns)
	if plannedMissing > 0 {
		shotsPerScript := config.ShotCount
		if shotsPerScript <= 0 {
			shotsPerScript = 1
		}
		if err := addQuote("assets:planned", "资产提取（预算）", "assets", plannedMissing, localtask.CreateRequest{
			Type: "canvas_text", Operation: "chapter_character_breakdown", Prompt: "从剧本提取角色、场景和道具资产",
			Model: textModelName, LogicalModelID: stringValue(textConfig["logicalModelId"]),
			Input: map[string]any{"mode": "text", "prompt": "从剧本提取角色、场景和道具资产", "config": textConfig,
				"metadata": map[string]any{"source": "smart-film-batch-worker", "batchId": batch.ID, "skillSnapshot": config.SkillSnapshot}},
		}); err != nil {
			return SmartFilmBatchCostView{}, err
		}
		if err := addQuote("storyboard:planned", "分镜规划（预算）", "storyboard", plannedMissing, localtask.CreateRequest{
			Type: "canvas_text", Operation: "storyboard", Prompt: "短剧分镜规划", Model: textModelName,
			LogicalModelID: stringValue(textConfig["logicalModelId"]),
			Input: map[string]any{"mode": "text", "prompt": "短剧分镜规划", "config": textConfig,
				"metadata": map[string]any{"source": "smart-film-batch-worker", "batchId": batch.ID, "skillSnapshot": config.SkillSnapshot}},
		}); err != nil {
			return SmartFilmBatchCostView{}, err
		}
		imageModel, imageConfig, imageErr := s.smartFilmImageStageConfig(config, batch)
		if imageErr == nil {
			if err := addQuote("image:planned", "分镜图（预算）", "image", plannedMissing*shotsPerScript, localtask.CreateRequest{
				Type: "canvas_image", Operation: "image", Prompt: "镜头分镜图", Model: modelNameFromOption(imageModel),
				LogicalModelID: stringValue(imageConfig["logicalModelId"]),
				Input: map[string]any{"mode": "image", "prompt": "镜头分镜图", "config": imageConfig,
					"metadata": map[string]any{"source": "short-drama-workflow", "batchId": batch.ID}},
			}); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
		videoModel, videoConfig, videoErr := s.smartFilmVideoStageConfig(config, batch)
		if videoErr == nil {
			durations := smartFilmRemainingVideoDurations(config, nil, smartFilmTaskStageUsage{})
			if config.ProductionMode == SmartFilmProductionModeSmart {
				durations = []smartFilmDurationCount{{Seconds: config.TargetDurationSeconds, Count: 1}}
			}
			videoConfig["videoGenerateAudio"] = strconv.FormatBool(smartFilmResolvedAudioMode(config) == SmartFilmAudioModeNative)
			for _, duration := range durations {
				videoConfig["videoSeconds"] = fmt.Sprintf("%.0f", duration.Seconds)
				if err := addQuote(fmt.Sprintf("video:planned:%g", duration.Seconds), "镜头视频（预算）", "video", plannedMissing*duration.Count, localtask.CreateRequest{
					Type: "canvas_video", Operation: "image_to_video", Prompt: "镜头视频", Model: modelNameFromOption(videoModel),
					LogicalModelID: stringValue(videoConfig["logicalModelId"]),
					Input: map[string]any{"mode": "video", "prompt": "镜头视频", "config": videoConfig,
						"metadata": map[string]any{"source": "short-drama-workflow", "batchId": batch.ID}},
				}); err != nil {
					return SmartFilmBatchCostView{}, err
				}
			}
			if smartFilmResolvedAudioMode(config) == SmartFilmAudioModeSeparate {
				audioConfigured, configureErr := s.smartFilmAudioConfigured(batch)
				if configureErr != nil {
					return SmartFilmBatchCostView{}, configureErr
				}
				if audioConfigured {
					if err := s.addSmartFilmAudioCosts(userID, batch, "待创建项目", plannedMissing*shotsPerScript, plannedMissing, &items, &enabled, &balance, &balanceSet); err != nil {
						return SmartFilmBatchCostView{}, err
					}
				} else if config.AudioMode == SmartFilmAudioModeSeparate {
					return SmartFilmBatchCostView{}, errors.New("批次缺少可用的旁白或 BGM 模型")
				}
			}
		}
	}
	return smartFilmBatchCostSummary(batch, committed, items, enabled, balance), nil
}

func smartFilmBatchCostSummary(batch *model.SmartFilmBatch, committed int, items []SmartFilmBatchCostItem, enabled bool, balance int) SmartFilmBatchCostView {
	estimated := 0
	for _, item := range items {
		estimated += item.Points
	}
	total := committed + estimated
	return SmartFilmBatchCostView{
		Enabled: enabled, BudgetPoints: batch.BudgetPoints, CommittedPoints: committed,
		EstimatedPoints: estimated, TotalPoints: total,
		OverBudget: batch.BudgetPoints > 0 && total > batch.BudgetPoints,
		Balance:    balance, Items: items,
	}
}

func (s *Service) smartFilmAudioConfigured(batch *model.SmartFilmBatch) (bool, error) {
	snapshot, err := s.SmartFilmOrchestrationConfig(batch)
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(stringValue(snapshot.AudioVoice["model"])) != "" &&
		strings.TrimSpace(stringValue(snapshot.AudioMusic["model"])) != "", nil
}

func (s *Service) addSmartFilmAudioCosts(userID string, batch *model.SmartFilmBatch, projectName string, narrationCount, musicCount int, items *[]SmartFilmBatchCostItem, enabled *bool, balance *int, balanceSet *bool) error {
	if narrationCount <= 0 && musicCount <= 0 {
		return nil
	}
	voiceModel, voiceConfig := "", map[string]any{}
	if narrationCount > 0 {
		var voiceErr error
		voiceModel, voiceConfig, voiceErr = s.smartFilmAudioStageConfig(batch, true)
		if voiceErr != nil {
			return voiceErr
		}
	}
	musicModel, musicConfig := "", map[string]any{}
	if musicCount > 0 {
		var musicErr error
		musicModel, musicConfig, musicErr = s.smartFilmAudioStageConfig(batch, false)
		if musicErr != nil {
			return musicErr
		}
	}
	add := func(key, label, stage string, count int, req localtask.CreateRequest) error {
		if count <= 0 || s.quoteTask == nil {
			return nil
		}
		quote, err := s.quoteTask(userID, req)
		if err != nil {
			return err
		}
		if quote == nil {
			return nil
		}
		if quote.Enabled {
			*enabled = true
			if !*balanceSet || quote.Balance < *balance {
				*balance = quote.Balance
				*balanceSet = true
			}
		}
		*items = append(*items, SmartFilmBatchCostItem{Key: key, Label: label, Stage: stage, Count: count, Points: quote.Points * count, Enabled: quote.Enabled})
		return nil
	}
	if err := add("audio:voice:"+batch.ID, "逐镜旁白 · "+projectName, "audio", narrationCount, localtask.CreateRequest{
		Type: "canvas_audio", Operation: "audio", Prompt: "镜头旁白", Model: modelNameFromOption(voiceModel),
		LogicalModelID: stringValue(voiceConfig["logicalModelId"]),
		Input: map[string]any{"mode": "audio", "prompt": "镜头旁白", "config": voiceConfig,
			"metadata": map[string]any{"source": "smart-film-narration", "batchId": batch.ID, "audioPurpose": "voice"}},
	}); err != nil {
		return err
	}
	if err := add("audio:music:"+batch.ID, "背景音乐 · "+projectName, "audio", musicCount, localtask.CreateRequest{
		Type: "canvas_audio", Operation: "audio", Prompt: "纯器乐背景音乐", Model: modelNameFromOption(musicModel),
		LogicalModelID: stringValue(musicConfig["logicalModelId"]),
		Input: map[string]any{"mode": "audio", "prompt": "纯器乐背景音乐", "config": musicConfig,
			"metadata": map[string]any{"source": "smart-film-bgm", "batchId": batch.ID, "audioPurpose": "music"}},
	}); err != nil {
		return err
	}
	return nil
}

func (s *Service) smartFilmVideoStageConfig(config SmartFilmBatchConfig, batch *model.SmartFilmBatch) (string, map[string]any, error) {
	snapshot, err := s.SmartFilmOrchestrationConfig(batch)
	if err != nil {
		return "", nil, err
	}
	configMap := make(map[string]any, len(snapshot.Video)+2)
	for key, value := range snapshot.Video {
		configMap[key] = value
	}
	modelName := strings.TrimSpace(stringValue(configMap["model"]))
	channelID := strings.TrimSpace(stringValue(configMap["channelId"]))
	if modelName == "" {
		channelID, modelName = splitSmartFilmModelOption(config.DefaultVideoModel)
	}
	if modelName == "" {
		return "", nil, errors.New("批次没有可用的视频模型")
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

func (s *Service) smartFilmImageStageConfig(config SmartFilmBatchConfig, batch *model.SmartFilmBatch) (string, map[string]any, error) {
	snapshot, err := s.SmartFilmOrchestrationConfig(batch)
	if err != nil {
		return "", nil, err
	}
	configMap := make(map[string]any, len(snapshot.Image)+2)
	for key, value := range snapshot.Image {
		configMap[key] = value
	}
	modelName := strings.TrimSpace(stringValue(configMap["model"]))
	channelID := strings.TrimSpace(stringValue(configMap["channelId"]))
	if modelName == "" {
		channelID, modelName = splitSmartFilmModelOption(config.DefaultImageModel)
	}
	if modelName == "" {
		return "", nil, errors.New("批次没有可用的图片模型")
	}
	configMap["model"] = modelName
	if channelID != "" {
		configMap["channelId"] = channelID
	}
	return smartFilmModelOption(channelID, modelName), configMap, nil
}

func (s *Service) smartFilmAudioStageConfig(batch *model.SmartFilmBatch, voice bool) (string, map[string]any, error) {
	snapshot, err := s.SmartFilmOrchestrationConfig(batch)
	if err != nil {
		return "", nil, err
	}
	source := snapshot.AudioMusic
	label := "背景音乐"
	if voice {
		source = snapshot.AudioVoice
		label = "旁白"
	}
	configMap := make(map[string]any, len(source)+1)
	for key, value := range source {
		configMap[key] = value
	}
	modelName := strings.TrimSpace(stringValue(configMap["model"]))
	if modelName == "" {
		return "", nil, fmt.Errorf("批次缺少可用的%s模型", label)
	}
	channelID := strings.TrimSpace(stringValue(configMap["channelId"]))
	return smartFilmModelOption(channelID, modelName), configMap, nil
}

func smartFilmResolvedAudioMode(config SmartFilmBatchConfig) string {
	switch config.AudioMode {
	case SmartFilmAudioModeNative, SmartFilmAudioModeSeparate, SmartFilmAudioModeNone:
		return config.AudioMode
	case SmartFilmAudioModeAuto:
		if config.VideoNativeAudio {
			return SmartFilmAudioModeNative
		}
		return SmartFilmAudioModeSeparate
	default:
		return SmartFilmAudioModeSeparate
	}
}

func smartFilmModelOption(channelID, modelName string) string {
	modelName = strings.TrimSpace(modelName)
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return modelName
	}
	return channelID + "::" + modelName
}

func modelNameFromOption(option string) string {
	_, modelName := splitSmartFilmModelOption(option)
	return modelName
}
