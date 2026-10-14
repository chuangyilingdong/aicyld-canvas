package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
)

// 平台统一渠道（platformchannels 包）在浏览器侧走 /api/ai/custom 中转即可工作；
// 但服务端任务执行路径（app/task_creation.go → modelcatalog.SelectTaskModel →
// repo.SystemChannel / ChannelModelByKey）只认数据库里的系统渠道。
// 因此本文件把平台渠道镜像成 scope=system 的系统渠道，让两条路径看到同一个渠道。

// PlatformChannelModel 是平台渠道里的一个模型（能力 + 请求协议 + 可选能力配置）。
type PlatformChannelModel struct {
	Model            string          `json:"model"`
	DisplayName      string          `json:"displayName,omitempty"`
	Capability       string          `json:"capability"`
	Protocol         string          `json:"protocol"`
	CapabilityConfig json.RawMessage `json:"capabilityConfig,omitempty"`
}

// PlatformChannelInput 是平台渠道在服务端的镜像输入。
type PlatformChannelInput struct {
	ID               string                 `json:"id"`
	Name             string                 `json:"name"`
	BaseURL          string                 `json:"baseUrl"`
	APIKey           string                 `json:"apiKey"`
	ConcurrencyLimit int                    `json:"concurrencyLimit"`
	Enabled          bool                   `json:"enabled"`
	SortOrder        int                    `json:"sortOrder"`
	Models           []PlatformChannelModel `json:"modelProfiles"`
}

// defaultPlatformVideoCapabilityConfig 是没有传入能力配置时的视频模型默认值，
// 与前端 lib/model-capabilities.ts 的默认一致（见 isValidPlatformVideoConfig 的校验口径）。
const defaultPlatformVideoCapabilityConfig = `{
  "version": 1,
  "video": {
    "references": {
      "promptMaxChars": 4000,
      "minImages": 0,
      "maxImages": 9,
      "maxImageBytes": 31457280,
      "maxVideos": 0,
      "maxVideoBytes": 0,
      "maxVideoDurationSeconds": 0,
      "maxAudios": 0,
      "maxAudioBytes": 0,
      "maxAudioDurationSeconds": 0
    },
    "duration": { "selection": "range", "min": 1, "max": 15, "step": 1, "default": 6 },
    "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    "defaultRatio": "16:9",
    "resolutions": ["480p", "720p", "1080p"],
    "defaultResolution": "720p",
    "generateAudio": { "supported": false, "default": false },
    "watermark": { "supported": false, "default": false },
    "operations": ["text_to_video", "image_to_video"],
    "defaultOperation": "text_to_video"
  }
}`

// platformChannelActor 是镜像写入使用的内部管理员身份（不对外暴露、不可登录）。
func platformChannelActor() *model.User {
	return &model.User{
		ID: "aicyld-platform", Username: "aicyld-platform", DisplayName: "平台渠道同步",
		Role: model.UserRoleAdmin, Status: model.UserStatusActive,
	}
}

// SyncPlatformChannels 把平台渠道镜像为系统渠道。单条渠道失败不影响其它渠道，
// 返回可读的告警（镜像失败时浏览器侧的中转仍然可用，只是服务端任务路径不可用）。
func (s *Service) SyncPlatformChannels(inputs []PlatformChannelInput) []string {
	if s == nil || s.repo == nil {
		return []string{"服务未初始化，平台渠道未镜像到系统渠道"}
	}
	warnings := make([]string, 0)
	for _, input := range inputs {
		if err := s.syncPlatformChannel(input); err != nil {
			warnings = append(warnings, fmt.Sprintf("%s: %v", input.ID, err))
		}
	}
	return warnings
}

func (s *Service) syncPlatformChannel(input PlatformChannelInput) error {
	channelID := strings.TrimSpace(input.ID)
	if channelID == "" {
		return errors.New("缺少渠道 ID")
	}
	if len([]rune(channelID)) > 36 {
		return fmt.Errorf("渠道 ID 超过 36 个字符：%s", channelID)
	}
	if strings.TrimSpace(input.BaseURL) == "" {
		return errors.New("缺少 Base URL")
	}
	names := make([]string, 0, len(input.Models))
	for _, profile := range input.Models {
		if name := strings.TrimSpace(profile.Model); name != "" {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return errors.New("至少需要一个模型")
	}
	actor := platformChannelActor()
	enabled := input.Enabled
	req := ChannelRequest{
		Name: input.Name, BaseURL: input.BaseURL, APIKey: input.APIKey,
		Models: names, Enabled: &enabled,
	}
	if input.ConcurrencyLimit > 0 {
		limit := input.ConcurrencyLimit
		req.ConcurrencyLimit = &limit
	}
	if input.SortOrder > 0 {
		order := input.SortOrder
		req.SortOrder = &order
	}

	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		created := model.ModelChannel{ID: channelID, UserID: actor.ID, Scope: model.ChannelScopeSystem, Enabled: true}
		prepared, applyErr := modelcatalog.ApplyChannelRequest(req, created)
		if applyErr != nil {
			return applyErr
		}
		if err := s.encryptSystemChannelSecrets(&prepared); err != nil {
			return err
		}
		if err := s.repo.Create(&prepared); err != nil {
			return fmt.Errorf("创建系统渠道失败：%w", err)
		}
		channel = &prepared
	} else if _, err := s.UpdateSystemChannel(actor, channelID, req); err != nil {
		return fmt.Errorf("更新系统渠道失败：%w", err)
	}

	if err := s.syncInitialChannelModels(channel, names); err != nil {
		return fmt.Errorf("同步系统渠道模型失败：%w", err)
	}
	for _, profile := range input.Models {
		name := strings.TrimSpace(profile.Model)
		if name == "" {
			continue
		}
		row, err := s.repo.ChannelModelByKeyIncludingDisabled(channelID, name)
		if err != nil || row == nil {
			continue
		}
		config, err := platformModelCapabilityConfig(profile, row.CapabilityConfigJSON)
		if err != nil {
			return err
		}
		itemEnabled := true
		if _, err := s.SaveAdminChannelModel(actor, channelID, row.ID, ChannelModelRequest{
			ModelKey: name, DisplayName: profile.DisplayName, Capability: profile.Capability,
			Protocol: profile.Protocol, Enabled: &itemEnabled, CapabilityConfig: config,
		}); err != nil {
			return fmt.Errorf("模型 %s 配置失败：%w", name, err)
		}
	}
	return nil
}

// platformModelCapabilityConfig 解析模型能力配置，优先级：
// 本次提交的能力配置 → 数据库里已有的能力配置（避免后台只改密钥时把能力配置抹掉）
// → 视频模型的内置默认值。
func platformModelCapabilityConfig(profile PlatformChannelModel, stored string) (*ModelCapabilityConfig, error) {
	raw := strings.TrimSpace(string(profile.CapabilityConfig))
	if raw != "" && raw != "null" {
		var config ModelCapabilityConfig
		if err := json.Unmarshal([]byte(raw), &config); err != nil {
			return nil, fmt.Errorf("模型 %s 的能力配置不是有效 JSON：%w", profile.Model, err)
		}
		return &config, nil
	}
	if existing := strings.TrimSpace(stored); existing != "" && existing != "null" {
		var config ModelCapabilityConfig
		if err := json.Unmarshal([]byte(existing), &config); err == nil {
			return &config, nil
		}
	}
	if !strings.EqualFold(strings.TrimSpace(profile.Capability), "video") {
		return nil, fmt.Errorf("模型 %s 缺少能力配置（仅视频模型可缺省）", profile.Model)
	}
	var config ModelCapabilityConfig
	if err := json.Unmarshal([]byte(defaultPlatformVideoCapabilityConfig), &config); err != nil {
		return nil, err
	}
	return &config, nil
}
