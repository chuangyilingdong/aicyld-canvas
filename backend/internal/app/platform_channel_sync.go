package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/platformchannels"
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
	modelFailures := make([]string, 0)
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
			modelFailures = append(modelFailures, err.Error())
			continue
		}
		itemEnabled := true
		if _, err := s.SaveAdminChannelModel(actor, channelID, row.ID, ChannelModelRequest{
			ModelKey: name, DisplayName: profile.DisplayName, Capability: profile.Capability,
			Protocol: profile.Protocol, Enabled: &itemEnabled, CapabilityConfig: config,
		}); err != nil {
			modelFailures = append(modelFailures, fmt.Sprintf("模型 %s 配置失败：%v", name, err))
		}
	}
	if len(modelFailures) > 0 {
		return errors.New(strings.Join(modelFailures, "；"))
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
	// 按能力类型生成配置：视频按模型名细分（Seedance 家族识别 t2v/i2v/multi），
	// 图片/文本用通用模板，音频不需要能力配置。口径与前端默认值一致。
	body, ok := platformchannels.CapabilityConfigFor(profile.Capability, profile.Model)
	if !ok {
		return nil, fmt.Errorf("模型 %s 的能力类型 %q 不受支持", profile.Model, profile.Capability)
	}
	if len(body) == 0 {
		return nil, nil
	}
	var config ModelCapabilityConfig
	if err := json.Unmarshal(body, &config); err != nil {
		return nil, err
	}
	return &config, nil
}
