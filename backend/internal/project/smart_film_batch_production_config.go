package project

import (
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

const (
	maxSmartFilmSkillStageChars = 40_000
	maxSmartFilmSkillTotalChars = 180_000
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

func (s *Service) UpdateSmartFilmBatchSkill(userID, batchID string, req UpdateSmartFilmBatchSkillRequest) (SmartFilmBatchView, error) {
	if req.ExpectedRevision <= 0 {
		return SmartFilmBatchView{}, kernel.BadAuthRequest("请刷新后再更换技能")
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
	for _, script := range scripts {
		if strings.TrimSpace(script.ProjectID) != "" {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("已有项目开始制作，不能再更换批次技能")
		}
	}
	runs, err := s.repo.SmartFilmProductionRunsForBatch(userID, batchID)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	for _, run := range runs {
		if strings.TrimSpace(run.ProjectID) != "" {
			return SmartFilmBatchView{}, kernel.BadAuthRequest("已有项目开始制作，不能再更换批次技能")
		}
	}
	config, err := smartFilmBatchConfig(batch)
	if err != nil {
		return SmartFilmBatchView{}, err
	}
	config.SkillSnapshot = req.SkillSnapshot
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

func normalizeSmartFilmInputAssetNames(values map[string]string) (map[string]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(values))
	for assetID, name := range values {
		assetID = strings.TrimSpace(assetID)
		name = strings.TrimSpace(name)
		if assetID == "" || name == "" {
			continue
		}
		if utf8.RuneCountInString(name) > 80 {
			return nil, kernel.BadAuthRequest("人物名称不能超过 80 个字符")
		}
		result[assetID] = name
	}
	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}

func filterSmartFilmInputAssetNames(values map[string]string, assetIDs []string) map[string]string {
	if len(values) == 0 || len(assetIDs) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(assetIDs))
	for _, assetID := range assetIDs {
		allowed[assetID] = struct{}{}
	}
	result := make(map[string]string, len(values))
	for assetID, name := range values {
		if _, ok := allowed[assetID]; ok {
			result[assetID] = name
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func validateSmartFilmCharacterNames(config SmartFilmBatchConfig, assetIDs []string) error {
	for _, assetID := range assetIDs {
		if strings.TrimSpace(config.InputAssetRoles[assetID]) != "character" {
			continue
		}
		name := strings.TrimSpace(config.InputAssetNames[assetID])
		if name == "" {
			return kernel.BadAuthRequest("请为每个人物参考图填写人物名称")
		}
	}
	return nil
}

func normalizeSmartFilmSkillSnapshot(snapshot *SmartFilmSkillSnapshot) (*SmartFilmSkillSnapshot, error) {
	if snapshot == nil {
		return nil, nil
	}
	skillID := strings.TrimSpace(snapshot.SkillID)
	versionID := strings.TrimSpace(snapshot.VersionID)
	contentHash := strings.TrimSpace(snapshot.ContentHash)
	name := strings.TrimSpace(snapshot.Name)
	version := strings.TrimSpace(snapshot.Version)
	routingMode := strings.TrimSpace(snapshot.RoutingMode)
	if skillID == "" && versionID == "" && contentHash == "" && name == "" && len(snapshot.Stages) == 0 {
		return nil, nil
	}
	if skillID == "" || versionID == "" || contentHash == "" || name == "" {
		return nil, kernel.BadAuthRequest("技能版本信息不完整，请重新选择技能")
	}
	allowed := map[string]struct{}{
		SmartFilmSkillStageScript: {}, SmartFilmSkillStageAssets: {}, SmartFilmSkillStageStoryboard: {},
		SmartFilmSkillStageImage: {}, SmartFilmSkillStageVideo: {},
	}
	stages := make(map[string]string, len(snapshot.Stages))
	total := 0
	for stage, value := range snapshot.Stages {
		stage = strings.TrimSpace(stage)
		if _, ok := allowed[stage]; !ok {
			return nil, kernel.BadAuthRequest("技能阶段配置无效")
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if utf8.RuneCountInString(value) > maxSmartFilmSkillStageChars {
			return nil, kernel.BadAuthRequest("技能规则上下文过大，请减少技能引用的参考文件")
		}
		total += utf8.RuneCountInString(value)
		if total > maxSmartFilmSkillTotalChars {
			return nil, kernel.BadAuthRequest("技能规则上下文总大小超过限制")
		}
		stages[stage] = value
	}
	if len(stages) == 0 {
		return nil, kernel.BadAuthRequest("技能没有可用的阶段规则")
	}
	if routingMode == "" {
		routingMode = "auto"
	}
	if routingMode != "manifest" && routingMode != "auto" {
		return nil, kernel.BadAuthRequest("技能阶段路由模式无效")
	}
	stageFiles := make(map[string][]string, len(snapshot.StageFiles))
	for stage, paths := range snapshot.StageFiles {
		stage = strings.TrimSpace(stage)
		if _, ok := allowed[stage]; !ok {
			return nil, kernel.BadAuthRequest("技能阶段文件配置无效")
		}
		cleaned := make([]string, 0, len(paths))
		for _, filePath := range paths {
			filePath = strings.TrimSpace(filePath)
			if filePath == "" || utf8.RuneCountInString(filePath) > 1000 {
				continue
			}
			cleaned = append(cleaned, filePath)
		}
		if len(cleaned) > 8 {
			return nil, kernel.BadAuthRequest("单个技能阶段引用的文件过多")
		}
		if len(cleaned) > 0 {
			stageFiles[stage] = cleaned
		}
	}
	return &SmartFilmSkillSnapshot{
		SkillID: skillID, VersionID: versionID, ContentHash: contentHash, Name: name, Version: version,
		RoutingMode: routingMode, Stages: stages, StageFiles: stageFiles,
	}, nil
}

func smartFilmSkillStage(config SmartFilmBatchConfig, stage string) (skillID, versionID, contentHash, context string) {
	if config.SkillSnapshot == nil {
		return "", "", "", ""
	}
	return config.SkillSnapshot.SkillID, config.SkillSnapshot.VersionID, config.SkillSnapshot.ContentHash, strings.TrimSpace(config.SkillSnapshot.Stages[stage])
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

func smartFilmInputAssetTitle(config SmartFilmBatchConfig, assetID string) (model.AssetCategory, string) {
	role := config.InputAssetRoles[assetID]
	category, title := smartFilmInputAssetLink(role)
	if role == "character" {
		if name := strings.TrimSpace(config.InputAssetNames[assetID]); name != "" {
			title = name
		}
	}
	return category, title
}
