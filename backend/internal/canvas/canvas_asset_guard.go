package canvas

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"

	"infinite-canvas/backend/internal/model"
)

type MediaAssetReference = asset.CanvasMediaReference

// validateCanvasMediaAssets is the final server-side invariant for canvas sync:
// a persisted canvas may only point at an uploaded Resource through an Asset
// owned by the same user. The client writes Assets before canvases, so rejecting
// an incomplete pair prevents a durable Resource-only (ghost capacity) state.
func (s *Service) ValidateCanvasMediaAssets(userID string, raw json.RawMessage) error {
	return s.validateCanvasMediaAssetsWithCandidates(userID, raw, nil)
}

func (s *Service) validateCanvasMediaAssetsWithCandidates(userID string, raw json.RawMessage, candidates []model.Asset) error {
	references, err := MediaAssetReferences(raw)
	if err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	if len(references) == 0 {
		return nil
	}

	assetIDSet := make(map[string]struct{}, len(references))
	resourceIDSet := make(map[string]struct{}, len(references))
	for _, reference := range references {
		if reference.AssetID == "" {
			logCanvasAssetMismatch("引用缺少 assetId", reference, references)
			return kernel.BadAuthRequest("画布媒体尚未进入素材库，请等待同步完成后重试")
		}
		assetIDSet[reference.AssetID] = struct{}{}
		resourceIDSet[reference.ResourceID] = struct{}{}
	}

	ownedAssets, err := s.repo.AssetsForUserIDs(userID, assets.SortedIDs(assetIDSet))
	if err != nil {
		return err
	}
	assetResources := make(map[string]map[string]struct{}, len(ownedAssets))
	for _, asset := range ownedAssets {
		assetResources[asset.ID] = assets.DocumentReferencedIDs(asset.PayloadJSON, resourceIDSet)
	}
	for _, asset := range candidates {
		if asset.UserID == userID {
			assetResources[asset.ID] = assets.DocumentReferencedIDs(asset.PayloadJSON, resourceIDSet)
		}
	}

	resources, err := s.repo.ResourcesForUserIDs(userID, assets.SortedIDs(resourceIDSet))
	if err != nil {
		return err
	}
	readyResources := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		if resource.Status == model.ResourceStatusReady {
			readyResources[resource.ID] = struct{}{}
		}
	}

	for _, reference := range references {
		if _, exists := readyResources[reference.ResourceID]; !exists {
			return kernel.BadAuthRequest("画布媒体对应的资源不存在或尚未就绪，请重新上传")
		}
		resourceIDs, assetExists := assetResources[reference.AssetID]
		if !assetExists {
			// 客户端可能带了一个「本地生成但没回写服务端」的 assetId。只要该资源确实被
			// 本人某条素材引用，就认这次提交并记下实际 id —— 否则整份画布会永远存不上。
			// 媒体仍然必须同时具备「已就绪资源 + 本人素材」，底线不变。
			if actual := s.canvasAssetOwningResource(userID, reference.ResourceID); actual != "" {
				log.Printf("[canvas-asset] 修正过期 assetId node=%q submitted=%q actual=%q resource=%q",
					reference.NodeID, reference.AssetID, actual, reference.ResourceID)
				continue
			}
			logCanvasAssetMismatch("素材不存在或不属于该用户", reference, references)
			return kernel.BadAuthRequest("画布媒体尚未进入素材库，请等待同步完成后重试")
		}
		if _, matches := resourceIDs[reference.ResourceID]; !matches {
			logCanvasAssetMismatch("素材未引用该资源", reference, references)
			return kernel.BadAuthRequest("画布媒体与素材库记录不一致，请重新同步")
		}
	}
	return nil
}

// canvasAssetOwningResource 在该用户名下找出引用了指定资源的素材 id（唯一命中才返回）。
func (s *Service) canvasAssetOwningResource(userID string, resourceID string) string {
	candidates, err := s.repo.AssetsReferencingResource(userID, resourceID)
	if err != nil || len(candidates) == 0 {
		return ""
	}
	refSet := map[string]struct{}{resourceID: {}}
	matched := ""
	for _, asset := range candidates {
		if _, ok := assets.DocumentReferencedIDs(asset.PayloadJSON, refSet)[resourceID]; !ok {
			continue
		}
		if matched != "" && matched != asset.ID {
			// 多条素材引用同一资源时不做自动修正，避免张冠李戴。
			return ""
		}
		matched = asset.ID
	}
	return matched
}

// logCanvasAssetMismatch 记录画布媒体校验失败的具体节点，方便定位是哪个节点没同步。
// 只记 ID，不记用户内容。
func logCanvasAssetMismatch(reason string, reference MediaAssetReference, all []MediaAssetReference) {
	var buffer strings.Builder
	for index, item := range all {
		if index > 0 {
			buffer.WriteString(" | ")
		}
		fmt.Fprintf(&buffer, "node=%q asset=%q resource=%q", item.NodeID, item.AssetID, item.ResourceID)
	}
	log.Printf("[canvas-asset] %s → node=%q asset=%q resource=%q；文档全部引用（%d）：%s",
		reason, reference.NodeID, reference.AssetID, reference.ResourceID, len(all), buffer.String())
}

// validateAssetCanvasReferences prevents an Asset update from changing the
// resource behind a canvas that already points at that Asset.
func (s *Service) ValidateAssetCanvasReferences(userID string, item model.Asset) error {
	return s.Library().GuardCanvasReferences(userID, item)
}

// validateAssetReplacementCanvasReferences applies the same invariant to the
// legacy full-replacement endpoint, which otherwise could silently remove an
// Asset that a canvas still needs.
func (s *Service) ValidateAssetReplacementCanvasReferences(userID string, replacement []model.Asset) error {
	return s.Library().GuardReplacementCanvasReferences(userID, replacement)
}

func MediaAssetReferences(raw json.RawMessage) ([]MediaAssetReference, error) {
	return asset.CanvasMediaReferences(raw)
}
