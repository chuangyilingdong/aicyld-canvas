package database

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const canvasMediaAssetIdentityIndex = "idx_assets_active_media_resource"

type canvasMediaAssetRow struct {
	ID          string
	UserID      string
	Kind        string
	Status      string
	PayloadJSON string
	UpdatedAt   time.Time
}

// migrateCanvasMediaAssetIdentity repairs the historical bug where the same
// Resource was repeatedly materialized as a new Asset on canvas recovery. The
// newest/highest-value record stays active, every duplicate is archived, and
// current canvas/project references are rewritten to the surviving Asset.
func migrateCanvasMediaAssetIdentity(tx *gorm.DB) error {
	if !tx.Migrator().HasTable("assets") {
		return nil
	}
	if err := deduplicateCanvasMediaAssets(tx); err != nil {
		return err
	}
	return ensureSQLiteIndex(tx, "assets", canvasMediaAssetIdentityIndex,
		`CREATE UNIQUE INDEX `+canvasMediaAssetIdentityIndex+` ON assets(user_id, kind, json_extract(payload_json, '$.data.storageKey')) WHERE status <> 'archived' AND kind IN ('image', 'video', 'audio') AND json_extract(payload_json, '$.data.storageKey') LIKE 'resource:%'`)
}

func deduplicateCanvasMediaAssets(tx *gorm.DB) error {
	var rows []canvasMediaAssetRow
	if err := tx.Table("assets").
		Select("id, user_id, kind, status, payload_json, updated_at").
		Where("kind IN ? AND status <> ?", []string{"image", "video", "audio"}, model.AssetVersionStatusArchived).
		Find(&rows).Error; err != nil {
		return fmt.Errorf("读取待去重素材: %w", err)
	}
	if len(rows) < 2 {
		return nil
	}

	versionCounts, err := canvasMediaAssetVersionCounts(tx)
	if err != nil {
		return err
	}
	groups := make(map[string][]canvasMediaAssetRow)
	for _, row := range rows {
		key := canvasMediaResourceKey(row.PayloadJSON)
		if key == "" {
			continue
		}
		groupKey := row.UserID + "\x00" + row.Kind + "\x00" + key
		groups[groupKey] = append(groups[groupKey], row)
	}

	mappingsByUser := make(map[string]map[string]string)
	var archivedIDs []string
	for _, group := range groups {
		if len(group) < 2 {
			continue
		}
		canonical := chooseCanvasMediaAssetCanonical(group, versionCounts)
		for _, row := range group {
			if row.ID == canonical.ID {
				continue
			}
			if mappingsByUser[row.UserID] == nil {
				mappingsByUser[row.UserID] = make(map[string]string)
			}
			mappingsByUser[row.UserID][row.ID] = canonical.ID
			archivedIDs = append(archivedIDs, row.ID)
		}
	}
	if len(archivedIDs) == 0 {
		return nil
	}

	if err := rewriteCanvasDocumentsAssetIDs(tx, mappingsByUser); err != nil {
		return err
	}
	if err := rewriteCanvasSnapshotsAssetIDs(tx, mappingsByUser); err != nil {
		return err
	}
	if err := moveCanvasDuplicateAssetLinks(tx, mappingsByUser); err != nil {
		return err
	}
	if err := tx.Model(&model.Asset{}).
		Where("id IN ?", archivedIDs).
		Updates(map[string]any{"status": model.AssetVersionStatusArchived, "updated_at": time.Now().UTC()}).Error; err != nil {
		return fmt.Errorf("归档重复素材: %w", err)
	}
	return assertNoActiveCanvasMediaResourceDuplicates(tx)
}

func canvasMediaAssetVersionCounts(tx *gorm.DB) (map[string]int64, error) {
	if !tx.Migrator().HasTable("asset_versions") {
		return map[string]int64{}, nil
	}
	var rows []struct {
		AssetID string
		Count   int64
	}
	if err := tx.Table("asset_versions").
		Select("asset_id, COUNT(*) AS count").
		Group("asset_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("读取素材版本: %w", err)
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.AssetID] = row.Count
	}
	return counts, nil
}

func chooseCanvasMediaAssetCanonical(rows []canvasMediaAssetRow, versionCounts map[string]int64) canvasMediaAssetRow {
	canonical := rows[0]
	for _, candidate := range rows[1:] {
		if betterCanvasMediaAssetCanonical(candidate, canonical, versionCounts) {
			canonical = candidate
		}
	}
	return canonical
}

func betterCanvasMediaAssetCanonical(candidate, current canvasMediaAssetRow, versionCounts map[string]int64) bool {
	candidateVersioned := versionCounts[candidate.ID] > 0
	currentVersioned := versionCounts[current.ID] > 0
	if candidateVersioned != currentVersioned {
		return candidateVersioned
	}
	candidateGeneration := strings.HasPrefix(candidate.ID, "generation_")
	currentGeneration := strings.HasPrefix(current.ID, "generation_")
	if candidateGeneration != currentGeneration {
		return candidateGeneration
	}
	candidateConfirmed := candidate.Status == string(model.AssetVersionStatusConfirmed)
	currentConfirmed := current.Status == string(model.AssetVersionStatusConfirmed)
	if candidateConfirmed != currentConfirmed {
		return candidateConfirmed
	}
	if !candidate.UpdatedAt.Equal(current.UpdatedAt) {
		return candidate.UpdatedAt.After(current.UpdatedAt)
	}
	return candidate.ID > current.ID
}

func canvasMediaResourceKey(payloadJSON string) string {
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(payloadJSON), &payload) != nil {
		return ""
	}
	key := strings.TrimSpace(payload.Data.StorageKey)
	if !strings.HasPrefix(key, "resource:") || len(strings.TrimPrefix(key, "resource:")) == 0 {
		return ""
	}
	return key
}

func rewriteCanvasDocumentsAssetIDs(tx *gorm.DB, mappingsByUser map[string]map[string]string) error {
	if !tx.Migrator().HasTable("canvas_projects") {
		return nil
	}
	var documents []model.CanvasProject
	if err := tx.Select("id", "user_id", "payload_json").Find(&documents).Error; err != nil {
		return fmt.Errorf("读取画布素材引用: %w", err)
	}
	for _, document := range documents {
		mapping := mappingsByUser[document.UserID]
		if len(mapping) == 0 {
			continue
		}
		rewritten, changed, err := rewriteCanvasJSONAssetIDs(document.PayloadJSON, mapping)
		if err != nil {
			return fmt.Errorf("解析画布 %s 素材引用: %w", document.ID, err)
		}
		if !changed {
			continue
		}
		if err := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", document.ID, document.UserID).
			Update("payload_json", rewritten).Error; err != nil {
			return fmt.Errorf("更新画布 %s 素材引用: %w", document.ID, err)
		}
	}
	return nil
}

func rewriteCanvasSnapshotsAssetIDs(tx *gorm.DB, mappingsByUser map[string]map[string]string) error {
	if !tx.Migrator().HasTable("canvas_snapshots") {
		return nil
	}
	var snapshots []model.CanvasSnapshot
	if err := tx.Select("id", "user_id", "payload_json").Find(&snapshots).Error; err != nil {
		return fmt.Errorf("读取画布历史素材引用: %w", err)
	}
	for _, snapshot := range snapshots {
		mapping := mappingsByUser[snapshot.UserID]
		if len(mapping) == 0 {
			continue
		}
		rewritten, changed, err := rewriteCanvasJSONAssetIDs(snapshot.PayloadJSON, mapping)
		if err != nil {
			return fmt.Errorf("解析画布历史 %s 素材引用: %w", snapshot.ID, err)
		}
		if !changed {
			continue
		}
		if err := tx.Model(&model.CanvasSnapshot{}).Where("id = ? AND user_id = ?", snapshot.ID, snapshot.UserID).
			Update("payload_json", rewritten).Error; err != nil {
			return fmt.Errorf("更新画布历史 %s 素材引用: %w", snapshot.ID, err)
		}
	}
	return nil
}

func rewriteCanvasJSONAssetIDs(payloadJSON string, mapping map[string]string) (string, bool, error) {
	if strings.TrimSpace(payloadJSON) == "" {
		return payloadJSON, false, nil
	}
	var value any
	if err := json.Unmarshal([]byte(payloadJSON), &value); err != nil {
		return payloadJSON, false, err
	}
	if !rewriteCanvasJSONAssetIDValue(value, mapping) {
		return payloadJSON, false, nil
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return payloadJSON, false, err
	}
	return string(encoded), true, nil
}

func rewriteCanvasJSONAssetIDValue(value any, mapping map[string]string) bool {
	changed := false
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			if key == "assetId" || key == "materializedAssetId" {
				if id, ok := child.(string); ok {
					if canonical, exists := mapping[id]; exists {
						node[key] = canonical
						changed = true
						continue
					}
				}
			}
			if rewriteCanvasJSONAssetIDValue(child, mapping) {
				changed = true
			}
		}
	case []any:
		for _, child := range node {
			if rewriteCanvasJSONAssetIDValue(child, mapping) {
				changed = true
			}
		}
	}
	return changed
}

func moveCanvasDuplicateAssetLinks(tx *gorm.DB, mappingsByUser map[string]map[string]string) error {
	hasLinks := tx.Migrator().HasTable("project_asset_links")
	hasCandidates := tx.Migrator().HasTable("project_asset_candidates")
	if !hasLinks && !hasCandidates {
		return nil
	}
	for _, mapping := range mappingsByUser {
		for duplicateID, canonicalID := range mapping {
			if hasLinks {
				var links []model.ProjectAssetLink
				if err := tx.Where("asset_id = ?", duplicateID).Find(&links).Error; err != nil {
					return fmt.Errorf("读取重复素材项目关联: %w", err)
				}
				for _, link := range links {
					var existing int64
					if err := tx.Model(&model.ProjectAssetLink{}).
						Where("project_id = ? AND asset_id = ?", link.ProjectID, canonicalID).
						Count(&existing).Error; err != nil {
						return fmt.Errorf("检查重复素材项目关联: %w", err)
					}
					if existing > 0 {
						if err := tx.Delete(&model.ProjectAssetLink{}, "id = ?", link.ID).Error; err != nil {
							return fmt.Errorf("删除重复素材项目关联: %w", err)
						}
						continue
					}
					if err := tx.Model(&model.ProjectAssetLink{}).Where("id = ?", link.ID).
						Update("asset_id", canonicalID).Error; err != nil {
						return fmt.Errorf("迁移重复素材项目关联: %w", err)
					}
				}
			}
			if hasCandidates {
				if err := tx.Table("project_asset_candidates").Where("resolved_asset_id = ?", duplicateID).
					Update("resolved_asset_id", canonicalID).Error; err != nil {
					return fmt.Errorf("迁移重复素材候选引用: %w", err)
				}
			}
		}
	}
	return nil
}

func assertNoActiveCanvasMediaResourceDuplicates(tx *gorm.DB) error {
	var rows []canvasMediaAssetRow
	if err := tx.Table("assets").
		Select("id, user_id, kind, status, payload_json, updated_at").
		Where("kind IN ? AND status <> ?", []string{"image", "video", "audio"}, model.AssetVersionStatusArchived).
		Find(&rows).Error; err != nil {
		return fmt.Errorf("复核素材去重结果: %w", err)
	}
	seen := make(map[string]string, len(rows))
	for _, row := range rows {
		key := canvasMediaResourceKey(row.PayloadJSON)
		if key == "" {
			continue
		}
		identity := row.UserID + "\x00" + row.Kind + "\x00" + key
		if first, exists := seen[identity]; exists {
			return fmt.Errorf("素材去重未完成: user=%s kind=%s resource=%s assets=%s,%s", row.UserID, row.Kind, key, first, row.ID)
		}
		seen[identity] = row.ID
	}
	return nil
}
