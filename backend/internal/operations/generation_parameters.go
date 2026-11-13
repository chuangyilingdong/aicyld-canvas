package operations

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/modelcatalog"
)

// findCatalogModelCapability 按渠道和模型键定位目录能力。自定义模型的
// modelKey 通常写作 channel::model，同时兼容目录公开的 ID。
func findCatalogModelCapability(catalog *modelcatalog.CatalogResponse, modelKey string) *modelcatalog.ModelCapabilityConfig {
	if catalog == nil {
		return nil
	}
	channelID, shortKey := "", strings.TrimSpace(modelKey)
	if i := strings.Index(shortKey, "::"); i >= 0 {
		channelID, shortKey = strings.TrimSpace(shortKey[:i]), strings.TrimSpace(shortKey[i+2:])
	}
	if shortKey == "" {
		return nil
	}
	for _, channel := range catalog.Channels {
		if channelID != "" && channel.ID != channelID {
			continue
		}
		for _, model := range channel.Models {
			if model.ModelKey != shortKey && model.ID != shortKey {
				continue
			}
			if len(model.CapabilityConfig) == 0 {
				return nil
			}
			raw, err := json.Marshal(model.CapabilityConfig)
			if err != nil {
				return nil
			}
			value, err := modelcatalog.DecodeModelCapabilityConfig(string(raw))
			if err != nil {
				return nil
			}
			return value
		}
	}
	return nil
}
