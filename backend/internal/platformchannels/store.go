// Package platformchannels 保存「平台统一配置」的模型渠道。
//
// 背景：托管部署（hb.aicyld.com.cn）下模型渠道由后台统一维护，画布用户只读。
// 关键约定：
//   - 渠道定义只落盘在服务端数据目录（0600），API 永不返回明文密钥；
//   - 下发给浏览器的渠道使用占位密钥（PlaceholderSecret），真正的密钥替换发生在
//     服务端中转 /api/ai/custom（见 app.resolveCustomRelayKey）；
//   - 管理端通过带共享密钥的 /api/internal/channels 读写。
package platformchannels

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	// FileName 平台渠道定义文件名（位于画布数据目录）。
	FileName = "platform-channels.json"
	// MaskedSecret 是回显给管理端的脱敏标记；提交该值表示沿用原密钥。
	MaskedSecret = "__AICYLD_KEEP__"
	// PlaceholderSecret 是下发给浏览器的占位密钥，绝不是真实凭证。
	PlaceholderSecret = "system"
	// CredentialRef 标记「密钥由平台托管」的渠道。
	CredentialRef = "aicyld-platform"
	// ChannelIDPrefix 平台渠道 ID 前缀，便于与用户自定义渠道区分。
	ChannelIDPrefix = "aicyld-"

	schemaVersion = 1
)

// ModelProfile 描述单个模型的能力与请求协议。
type ModelProfile struct {
	Model            string          `json:"model"`
	DisplayName      string          `json:"displayName,omitempty"`
	Icon             string          `json:"icon,omitempty"`
	Capability       string          `json:"capability"`
	Protocol         string          `json:"protocol"`
	CapabilityConfig json.RawMessage `json:"capabilityConfig,omitempty"`
}

// Channel 是一条平台统一渠道。
type Channel struct {
	ID               string         `json:"id"`
	Name             string         `json:"name"`
	BaseURL          string         `json:"baseUrl"`
	APIKey           string         `json:"apiKey"`
	APIFormat        string         `json:"apiFormat"`
	Models           []string       `json:"models"`
	ModelProfiles    []ModelProfile `json:"modelProfiles"`
	ConcurrencyLimit int            `json:"concurrencyLimit"`
	Enabled          bool           `json:"enabled"`
	SortOrder        int            `json:"sortOrder"`
}

type document struct {
	Version  int       `json:"version"`
	Channels []Channel `json:"channels"`
}

// Store 绑定一个画布数据目录；同一目录共享一把锁，避免读改写竞争。
type Store struct {
	path string
	mu   *sync.Mutex
}

var storeGuards sync.Map

// New 返回绑定到 dataDir 的渠道存储。
func New(dataDir string) (*Store, error) {
	directory := strings.TrimSpace(dataDir)
	if directory == "" {
		return nil, errors.New("平台渠道数据目录不能为空")
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, fmt.Errorf("解析平台渠道目录失败: %w", err)
	}
	absolute = filepath.Clean(absolute)
	guard, _ := storeGuards.LoadOrStore(absolute, &sync.Mutex{})
	return &Store{path: filepath.Join(absolute, FileName), mu: guard.(*sync.Mutex)}, nil
}

// seedanceCapabilityConfig 是预置渠道 Seedance 2.0 的能力配置。
// 与前端 lib/model-capabilities.ts 的 seedance-2 + newapi 口径一致（含同步音频、
// 多素材参考与官方参考素材限制），避免服务端 admission 判为「参数超出支持范围」。
const seedanceCapabilityConfig = `{
  "version": 1,
  "video": {
    "references": {
      "promptMaxChars": 4000,
      "minImages": 0,
      "maxImages": 9,
      "maxImageBytes": 31457280,
      "maxVideos": 3,
      "maxVideoBytes": 209715200,
      "maxVideoDurationSeconds": 15,
      "minVideoDurationSeconds": 2,
      "maxVideoTotalDurationSeconds": 15,
      "maxAudios": 3,
      "maxAudioBytes": 15728640,
      "maxAudioDurationSeconds": 15,
      "minAudioDurationSeconds": 1.8,
      "maxAudioTotalDurationSeconds": 15,
      "minImageWidth": 300, "maxImageWidth": 6000,
      "minImageHeight": 300, "maxImageHeight": 6000,
      "minImageAspect": 0.4, "maxImageAspect": 2.5,
      "minVideoWidth": 300, "maxVideoWidth": 6000,
      "minVideoHeight": 300, "maxVideoHeight": 6000,
      "minVideoAspect": 0.4, "maxVideoAspect": 2.5,
      "minVideoPixels": 409600, "maxVideoPixels": 8295044
    },
    "duration": { "selection": "range", "min": 1, "max": 15, "step": 1, "default": 6 },
    "ratios": ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    "defaultRatio": "16:9",
    "resolutions": ["480p", "720p", "1080p"],
    "defaultResolution": "720p",
    "generateAudio": { "supported": true, "default": true },
    "watermark": { "supported": false, "default": false },
    "operations": ["text_to_video", "image_to_video", "reference_to_video"],
    "defaultOperation": "text_to_video"
  }
}`

// Defaults 是首次部署预置的渠道模板（阶段 4）：上游 ZhenZhen AI，
// OpenAI 兼容的异步视频任务接口，模型 Seedance 2.0。
func Defaults() []Channel {
	return []Channel{{
		ID:        ChannelIDPrefix + "seedance",
		Name:      "灵动TV 视频",
		BaseURL:   "https://api.seedance.nz",
		APIFormat: "openai",
		Models:    []string{"seedance-2.0"},
		ModelProfiles: []ModelProfile{{
			Model: "seedance-2.0", Capability: "video", Protocol: "newapi",
			CapabilityConfig: json.RawMessage(seedanceCapabilityConfig),
		}},
		ConcurrencyLimit: 3,
		Enabled:          true,
		SortOrder:        10,
	}}
}

// List 读取平台渠道；文件不存在时返回预置模板（不落盘，便于观测）。
func (s *Store) List() ([]Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() ([]Channel, error) {
	body, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return Defaults(), nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取平台渠道配置失败: %w", err)
	}
	var decoded document
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("平台渠道配置损坏: %w", err)
	}
	channels := make([]Channel, 0, len(decoded.Channels))
	for _, item := range decoded.Channels {
		normalized, normalizeErr := normalize(item)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		channels = append(channels, normalized)
	}
	return channels, nil
}

// Save 整体替换平台渠道定义。密钥提交脱敏标记（MaskedSecret）表示沿用已保存的密钥，
// 留空表示清除密钥（便于运维显式清空已泄露的凭证）。
func (s *Store) Save(incoming []Channel) ([]Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.loadLocked()
	if err != nil {
		return nil, err
	}
	previous := make(map[string]string, len(existing))
	for _, item := range existing {
		previous[item.ID] = item.APIKey
	}
	next := make([]Channel, 0, len(incoming))
	seen := make(map[string]struct{}, len(incoming))
	for _, item := range incoming {
		normalized, normalizeErr := normalize(item)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		if _, duplicated := seen[normalized.ID]; duplicated {
			return nil, fmt.Errorf("平台渠道 ID 重复: %s", normalized.ID)
		}
		seen[normalized.ID] = struct{}{}
		if normalized.APIKey == MaskedSecret {
			normalized.APIKey = previous[normalized.ID]
		}
		next = append(next, normalized)
	}
	if err := s.writeLocked(next); err != nil {
		return nil, err
	}
	return next, nil
}

func (s *Store) writeLocked(channels []Channel) error {
	body, err := json.MarshalIndent(document{Version: schemaVersion, Channels: channels}, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化平台渠道配置失败: %w", err)
	}
	body = append(body, '\n')
	directory := filepath.Dir(s.path)
	temp, err := os.CreateTemp(directory, ".platform-channels-*")
	if err != nil {
		return fmt.Errorf("创建平台渠道临时文件失败: %w", err)
	}
	tempName := temp.Name()
	defer os.Remove(tempName)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return fmt.Errorf("设置平台渠道文件权限失败: %w", err)
	}
	if _, err := temp.Write(body); err != nil {
		_ = temp.Close()
		return fmt.Errorf("写入平台渠道配置失败: %w", err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("同步平台渠道配置失败: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("关闭平台渠道临时文件失败: %w", err)
	}
	if err := os.Rename(tempName, s.path); err != nil {
		return fmt.Errorf("替换平台渠道配置失败: %w", err)
	}
	return nil
}

// ResolveAPIKey 按来源（scheme + host）解析平台密钥。浏览器只持有占位密钥，
// 真实凭证在服务端中转时按来源替换，避免密钥进入浏览器。
func (s *Store) ResolveAPIKey(targetURL string) (string, bool) {
	channels, err := s.List()
	if err != nil {
		return "", false
	}
	target, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil || target.Host == "" {
		return "", false
	}
	for _, channel := range channels {
		if !channel.Enabled || strings.TrimSpace(channel.APIKey) == "" {
			continue
		}
		base, parseErr := url.Parse(channel.BaseURL)
		if parseErr != nil || base.Host == "" {
			continue
		}
		if strings.EqualFold(base.Scheme, target.Scheme) && strings.EqualFold(base.Host, target.Host) {
			return channel.APIKey, true
		}
	}
	return "", false
}

// Redact 返回给管理端的副本：非空密钥替换为脱敏标记。
func Redact(channels []Channel) []Channel {
	result := make([]Channel, 0, len(channels))
	for _, item := range channels {
		cloned := item
		cloned.Models = append([]string(nil), item.Models...)
		cloned.ModelProfiles = append([]ModelProfile(nil), item.ModelProfiles...)
		if strings.TrimSpace(cloned.APIKey) != "" {
			cloned.APIKey = MaskedSecret
		}
		result = append(result, cloned)
	}
	return result
}

// PublicChannels 生成下发给浏览器的渠道条目：真实地址 + 占位密钥 + 平台标记。
func PublicChannels(channels []Channel) []map[string]any {
	result := make([]map[string]any, 0, len(channels))
	for _, channel := range channels {
		if !channel.Enabled {
			continue
		}
		models := append([]string(nil), channel.Models...)
		profiles := make([]any, 0, len(channel.ModelProfiles))
		for _, profile := range channel.ModelProfiles {
			entry := map[string]any{"model": profile.Model, "capability": profile.Capability, "protocol": profile.Protocol}
			if profile.DisplayName != "" {
				entry["displayName"] = profile.DisplayName
			}
			if profile.Icon != "" {
				entry["icon"] = profile.Icon
			}
			if len(profile.CapabilityConfig) > 0 {
				var capabilityConfig any
				if json.Unmarshal(profile.CapabilityConfig, &capabilityConfig) == nil {
					entry["capabilityConfig"] = capabilityConfig
				}
			}
			profiles = append(profiles, entry)
		}
		result = append(result, map[string]any{
			"id": channel.ID, "name": channel.Name, "baseUrl": channel.BaseURL,
			"apiKey": PlaceholderSecret, "secretKey": "", "headers": []any{},
			"apiFormat": channel.APIFormat, "scope": "system", "pinned": true,
			"enabled": true, "models": models, "modelProfiles": profiles,
			"credentialRef": CredentialRef, "hasApiKey": true, "hasSecretKey": false,
			"concurrencyLimit": channel.ConcurrencyLimit, "sortOrder": channel.SortOrder,
		})
	}
	return result
}

// IsPlatformChannel 判断渠道是否需要由平台统一维护（不允许用户/前端改写）。
func IsPlatformChannel(raw any) bool {
	channel, ok := raw.(map[string]any)
	if !ok {
		return false
	}
	credentialRef, _ := channel["credentialRef"].(string)
	if strings.TrimSpace(credentialRef) == CredentialRef {
		return true
	}
	id, _ := channel["id"].(string)
	return strings.HasPrefix(strings.TrimSpace(id), ChannelIDPrefix)
}

// Apply 把平台渠道合入一份（已脱敏的）模型配置：平台渠道始终排在前面，
// 同名 ID 一律以平台定义为准。
func Apply(config map[string]any, channels []Channel) map[string]any {
	if config == nil {
		return config
	}
	existing, _ := config["channels"].([]any)
	kept := make([]any, 0, len(existing))
	for _, raw := range existing {
		if IsPlatformChannel(raw) {
			continue
		}
		kept = append(kept, raw)
	}
	public := PublicChannels(channels)
	merged := make([]any, 0, len(public)+len(kept))
	for _, channel := range public {
		merged = append(merged, channel)
	}
	merged = append(merged, kept...)
	config["channels"] = merged
	return config
}

// Strip 从「客户端回传的配置」里移除平台渠道，避免覆盖服务端定义。
func Strip(config map[string]any) map[string]any {
	if config == nil {
		return config
	}
	existing, _ := config["channels"].([]any)
	kept := make([]any, 0, len(existing))
	for _, raw := range existing {
		if IsPlatformChannel(raw) {
			continue
		}
		kept = append(kept, raw)
	}
	config["channels"] = kept
	return config
}

func normalize(channel Channel) (Channel, error) {
	result := channel
	result.ID = strings.TrimSpace(result.ID)
	result.Name = strings.TrimSpace(result.Name)
	result.BaseURL = strings.TrimSpace(result.BaseURL)
	result.APIFormat = strings.ToLower(strings.TrimSpace(result.APIFormat))
	if result.ID == "" {
		return Channel{}, errors.New("平台渠道缺少 ID")
	}
	if !strings.HasPrefix(result.ID, ChannelIDPrefix) {
		result.ID = ChannelIDPrefix + result.ID
	}
	if result.Name == "" {
		result.Name = result.ID
	}
	if result.BaseURL == "" {
		return Channel{}, fmt.Errorf("平台渠道 %s 缺少 Base URL", result.ID)
	}
	parsed, err := url.Parse(result.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Channel{}, fmt.Errorf("平台渠道 %s 的 Base URL 无效", result.ID)
	}
	if result.APIFormat == "" {
		result.APIFormat = "openai"
	}
	switch result.APIFormat {
	case "openai", "gemini", "claude":
	default:
		return Channel{}, fmt.Errorf("平台渠道 %s 的接口格式无效", result.ID)
	}
	if result.ConcurrencyLimit < 0 {
		result.ConcurrencyLimit = 0
	}
	profiles := make([]ModelProfile, 0, len(result.ModelProfiles))
	seen := make(map[string]struct{}, len(result.ModelProfiles))
	for _, profile := range result.ModelProfiles {
		normalized := profile
		normalized.Model = strings.TrimSpace(profile.Model)
		normalized.Capability = strings.ToLower(strings.TrimSpace(profile.Capability))
		normalized.Protocol = strings.TrimSpace(profile.Protocol)
		if normalized.Model == "" || normalized.Capability == "" || normalized.Protocol == "" {
			return Channel{}, fmt.Errorf("平台渠道 %s 的模型协议不完整", result.ID)
		}
		switch normalized.Capability {
		case "text", "image", "video", "audio":
		default:
			return Channel{}, fmt.Errorf("平台渠道 %s 的模型能力无效", result.ID)
		}
		if _, duplicated := seen[normalized.Model]; duplicated {
			continue
		}
		seen[normalized.Model] = struct{}{}
		profiles = append(profiles, normalized)
	}
	result.ModelProfiles = profiles
	models := make([]string, 0, len(profiles)+len(result.Models))
	for _, profile := range profiles {
		models = append(models, profile.Model)
	}
	for _, model := range result.Models {
		trimmed := strings.TrimSpace(model)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		models = append(models, trimmed)
	}
	result.Models = models
	if len(result.Models) == 0 {
		return Channel{}, fmt.Errorf("平台渠道 %s 至少需要一个模型", result.ID)
	}
	return result, nil
}
