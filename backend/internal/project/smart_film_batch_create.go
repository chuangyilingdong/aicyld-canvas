package project

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

// PreviewSmartFilmBatchCost quotes the same normalized request that Create
// would persist. It intentionally allocates no IDs and writes no records.
func (s *Service) PreviewSmartFilmBatchCost(userID string, req CreateSmartFilmBatchRequest) (SmartFilmBatchCostView, error) {
	batch, config, err := s.prepareSmartFilmBatch(userID, req)
	if err != nil {
		return SmartFilmBatchCostView{}, err
	}
	batch.BudgetPoints = 0
	return s.smartFilmBatchCostView(userID, &batch, config, nil, req.ScriptPrompt)
}

func (s *Service) prepareSmartFilmBatch(userID string, req CreateSmartFilmBatchRequest) (model.SmartFilmBatch, SmartFilmBatchConfig, error) {
	title := strings.TrimSpace(req.Title)
	sourceText := strings.TrimSpace(req.SourceText)
	if title == "" {
		title = sourceText
	}
	if title == "" {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("批次名称不能为空")
	}
	if sourceText == "" {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("请先填写视频想法")
	}
	if len([]rune(sourceText)) > 50000 {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("视频想法不能超过 50000 个字符")
	}
	config, err := normalizeSmartFilmBatchConfig(req.Config)
	if err != nil {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, err
	}
	inputAssetIDs := normalizeSmartFilmInputAssetIDs(req.InputAssetIDs)
	if len(inputAssetIDs) > smartFilmInputAssetLimit {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest(fmt.Sprintf("参考图最多 %d 张", smartFilmInputAssetLimit))
	}
	if err := s.validateSmartFilmInputAssets(userID, inputAssetIDs); err != nil {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, err
	}
	config.InputAssetRoles = filterSmartFilmInputAssetRoles(config.InputAssetRoles, inputAssetIDs)
	config.InputAssetNames, err = normalizeSmartFilmInputAssetNames(config.InputAssetNames)
	if err != nil {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, err
	}
	config.InputAssetNames = filterSmartFilmInputAssetNames(config.InputAssetNames, inputAssetIDs)
	if err := validateSmartFilmCharacterNames(config, inputAssetIDs); err != nil {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, err
	}
	if req.BudgetPoints < 0 {
		return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("批次预算不能为负数")
	}
	now := time.Now()
	orchestrationCipher := ""
	if len(req.OrchestrationConfig) > 0 {
		if s.encryptSecret == nil {
			return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("当前环境无法保存后台编排配置")
		}
		raw, marshalErr := json.Marshal(req.OrchestrationConfig)
		if marshalErr != nil {
			return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("后台编排配置格式无效")
		}
		if len(raw) > 200<<10 {
			return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, kernel.BadAuthRequest("后台编排配置过大")
		}
		orchestrationCipher, err = s.encryptSecret(string(raw))
		if err != nil {
			return model.SmartFilmBatch{}, SmartFilmBatchConfig{}, fmt.Errorf("加密后台编排配置失败: %w", err)
		}
	}
	batch := model.SmartFilmBatch{
		UserID: userID, Title: truncateSmartFilmText(title, 240), SourceText: sourceText,
		InputAssetIDsJSON: mustJSON(inputAssetIDs), ConfigJSON: mustJSON(config), OrchestrationConfigCipher: orchestrationCipher, ScriptsJSON: "[]",
		Status: smartFilmBatchStatusDraft, BudgetPoints: req.BudgetPoints, Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	return batch, config, nil
}
