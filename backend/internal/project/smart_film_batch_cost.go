package project

import (
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

func (s *Service) UpdateSmartFilmBatchBudget(userID, batchID string, req UpdateSmartFilmBatchBudgetRequest) (SmartFilmBatchView, error) {
	if req.BudgetPoints < 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("批次预算不能为负数")
	}
	batch, err := s.repo.SetSmartFilmBatchBudget(userID, batchID, req.BudgetPoints)
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*batch)
}

func (s *Service) SmartFilmBatchCost(userID, batchID string) (SmartFilmBatchCostView, error) {
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	committed, err := s.repo.SmartFilmBatchCommittedPoints(userID, batchID)
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
	for _, run := range runs {
		if run.ProjectID == "" || run.UnitID == "" {
			continue
		}
		project, projectErr := s.repo.ProjectForUser(userID, run.ProjectID)
		if projectErr != nil {
			continue
		}
		textModel, textConfig, textErr := s.smartFilmTextStageConfig(config, batch)
		if textErr == nil && run.StoryboardStatus != SmartFilmProductionStageStatusReady {
			_, modelName := splitSmartFilmModelOption(textModel)
			textReq := localtask.CreateRequest{
				ProjectID: run.ProjectID, Type: "canvas_text", Operation: "storyboard", Prompt: "短剧分镜规划",
				Model: modelName, LogicalModelID: stringValue(textConfig["logicalModelId"]),
				Input: map[string]any{"mode": "text", "prompt": "短剧分镜规划", "config": textConfig,
					"metadata": map[string]any{"domainProjectId": run.ProjectID, "chapterId": run.UnitID, "source": "smart-film-cost-estimate"}},
			}
			if err := addQuote("storyboard:"+run.ID, "分镜生成 · "+project.Name, "storyboard", 1, textReq); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
		videoModel, videoConfig, videoErr := s.smartFilmVideoStageConfig(config, batch)
		if videoErr == nil {
			_, modelName := splitSmartFilmModelOption(videoModel)
			duration := config.ShotDurationSeconds
			if len(config.ShotDurationsSeconds) > 0 {
				duration = config.ShotDurationsSeconds[0]
			}
			videoConfig["videoSeconds"] = fmt.Sprintf("%.0f", duration)
			shotCount := config.ShotCount
			if shots, shotsErr := s.repo.ProjectUnitShots(run.ProjectID, run.UnitID); shotsErr == nil && len(shots) > 0 {
				shotCount = len(shots)
			}
			videoReq := localtask.CreateRequest{
				Type: "canvas_video", Operation: "image_to_video", Prompt: "镜头视频", Model: modelName,
				LogicalModelID: stringValue(videoConfig["logicalModelId"]),
				Input: map[string]any{"mode": "video", "prompt": "镜头视频", "config": videoConfig,
					"metadata": map[string]any{"source": "smart-film-cost-estimate", "videoEditOperation": "image_to_video"}},
			}
			if err := addQuote("video:"+run.ID, "镜头视频 · "+project.Name, "video", shotCount, videoReq); err != nil {
				return SmartFilmBatchCostView{}, err
			}
		}
	}
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
	}, nil
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
