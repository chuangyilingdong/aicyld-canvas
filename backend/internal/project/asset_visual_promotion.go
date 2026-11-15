package project

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) PromoteProjectAssetVisual(userID, projectID, assetID string, req PromoteProjectAssetVisualRequest) (AssetSummary, error) {
	if req.ExpectedRevision <= 0 {
		return AssetSummary{}, kernel.BadAuthRequest("请刷新后再生成资产图")
	}
	if _, err := s.Active(userID, projectID); err != nil {
		return AssetSummary{}, err
	}
	asset, err := s.repo.AssetForUser(userID, strings.TrimSpace(assetID))
	if err != nil {
		return AssetSummary{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, asset.ID)
	if err != nil {
		return AssetSummary{}, err
	}
	if !linked {
		return AssetSummary{}, kernel.BadAuthRequest("素材尚未加入当前项目")
	}
	if asset.Category == model.AssetCategoryCharacter {
		return AssetSummary{}, kernel.BadAuthRequest("角色请使用角色三视图生成入口")
	}
	if asset.Kind != "text" {
		return AssetSummary{}, kernel.BadAuthRequest("只有文本设定资产可以升级为视觉资产")
	}
	resourceID := strings.TrimSpace(req.ResourceID)
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return AssetSummary{}, err
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return AssetSummary{}, kernel.BadAuthRequest("资产图必须是已就绪的图片资源")
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		prompt = asset.Title
	}
	if len([]rune(prompt)) > 8000 {
		return AssetSummary{}, kernel.BadAuthRequest("资产图提示词过长")
	}
	modelName := strings.TrimSpace(req.Model)
	if len([]rune(modelName)) > 160 {
		return AssetSummary{}, kernel.BadAuthRequest("资产图模型名称过长")
	}
	taskID := strings.TrimSpace(req.TaskID)
	if taskID == "" {
		return AssetSummary{}, kernel.BadAuthRequest("资产图缺少生成任务")
	}
	currentVersion, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return AssetSummary{}, err
	}
	definition := map[string]any{}
	_ = json.Unmarshal([]byte(currentVersion.DefinitionJSON), &definition)
	definition["prompt"] = prompt
	definition["assetImageTaskId"] = taskID
	if modelName != "" {
		definition["assetImageModel"] = modelName
	}
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return AssetSummary{}, err
	}
	now := time.Now()
	versionID := kernel.NewID()
	version := model.AssetVersion{
		ID: versionID, AssetID: asset.ID, Status: model.AssetVersionStatusConfirmed,
		DefinitionJSON: string(definitionJSON), Prompt: prompt, Note: "promoted_from_text_asset", CreatedAt: now, UpdatedAt: now,
	}
	representation := model.AssetRepresentation{
		ID: kernel.NewID(), AssetVersionID: versionID, ResourceID: resource.ID,
		MediaType: resource.Kind, Role: "primary", TaskID: taskID, CreatedAt: now,
	}
	payload, err := json.Marshal(map[string]any{
		"id": asset.ID, "kind": resource.Kind, "category": asset.Category, "status": model.AssetVersionStatusConfirmed,
		"primaryVersionId": versionID, "title": asset.Title, "tags": []string{}, "data": map[string]any{
			"storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "kind": resource.Kind,
			"size": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs,
			"status": resource.Status, "mediaType": resource.Kind, "source": "text_asset_promotion",
		},
		"createdAt": asset.CreatedAt.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
	})
	if err != nil {
		return AssetSummary{}, err
	}
	asset.Kind = resource.Kind
	asset.Status = model.AssetVersionStatusConfirmed
	asset.PrimaryVersionID = versionID
	asset.PayloadJSON = string(payload)
	asset.UpdatedAt = now
	if err := s.repo.PromoteProjectAssetVisualActive(userID, projectID, asset, &version, &representation, req.ExpectedRevision, now); err != nil {
		return AssetSummary{}, mapProjectWriteError(err)
	}
	return s.assetSummary(userID, projectID, asset)
}
