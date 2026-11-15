package project

import (
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) UpdateSmartFilmBatchProductionConfig(userID, batchID string, req UpdateSmartFilmBatchProductionConfigRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再保存制作规格")
	}
	batch, err := s.repo.SmartFilmBatchForUser(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if batch.Revision != req.ExpectedRevision {
		return SmartFilmBatchView{}, kernel.WrapAppError(kernel.CodeConflict, "批次已发生变化，请刷新后重试", nil)
	}
	scripts, err := s.smartFilmScripts(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	if len(scripts) == 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请先生成并确认剧本，再设置制作规格")
	}
	for _, script := range scripts {
		if strings.TrimSpace(script.ProjectID) != "" {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("已有项目开始制作，不能再修改批次制作规格")
		}
	}
	config, err := smartFilmBatchConfig(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	config.ProductionMode = strings.TrimSpace(req.ProductionMode)
	config.ShotCount = req.ShotCount
	config.ShotDurationsSeconds = req.ShotDurationsSeconds
	config.ShotDurationSeconds = 0
	if len(req.ShotDurationsSeconds) > 0 {
		config.ShotDurationSeconds = req.ShotDurationsSeconds[0]
	}
	config.TargetDurationSeconds = req.TargetDurationSeconds
	config, err = normalizeSmartFilmBatchConfig(config)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	updated, err := s.repo.UpdateSmartFilmBatch(userID, batchID, req.ExpectedRevision, map[string]any{
		"config_json": mustJSON(config),
	})
	if err != nil {
		return SmartFilmBatchView{}, mapProjectWriteError(err)
	}
	return s.smartFilmBatchResponse(*updated)
}

func normalizeSmartFilmInputAssetRoles(values map[string]string) (map[string]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(values))
	for assetID, role := range values {
		assetID = strings.TrimSpace(assetID)
		role = strings.TrimSpace(role)
		if assetID == "" {
			continue
		}
		switch role {
		case "", "product", "scene", "character", "prop", "other":
		default:
			return nil, kernel.BadAuthRequest("参考图类型只支持产品、场景、人物、道具或其他")
		}
		if role == "" {
			role = "other"
		}
		result[assetID] = role
	}
	return result, nil
}

func filterSmartFilmInputAssetRoles(values map[string]string, assetIDs []string) map[string]string {
	if len(values) == 0 || len(assetIDs) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(assetIDs))
	for _, assetID := range assetIDs {
		allowed[assetID] = struct{}{}
	}
	result := make(map[string]string, len(values))
	for assetID, role := range values {
		if _, ok := allowed[assetID]; ok {
			result[assetID] = role
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func smartFilmInputAssetLink(role string) (model.AssetCategory, string) {
	switch strings.TrimSpace(role) {
	case "product":
		return model.AssetCategoryProp, "产品参考"
	case "scene":
		return model.AssetCategoryEnvironment, "场景参考"
	case "character":
		return model.AssetCategoryCharacter, "人物参考"
	case "prop":
		return model.AssetCategoryProp, "道具参考"
	default:
		return model.AssetCategoryOther, "其他参考"
	}
}
