// Package platformchannels 保存「平台统一配置」的模型渠道。
//
// 背景：托管部署（hb.aicyld.com.cn）下模型渠道由后台统一维护，画布用户只读。
// 关键约定：
//   - 渠道定义只落盘在服务端数据目录（0600），API 永不返回明文密钥；
//   - 下发给浏览器的渠道使用占位密钥（PlaceholderSecret），真正的密钥替换发生在
//     服务端中转 /api/ai/custom（见 app.resolveCustomRelayKey）；
//   - 管理端通过带共享密钥的 /api/internal/channels 读写；
//   - 同一份文件还存放「助手模型」：画布助手（灵动TV Agent）在服务端解析模型，
//     后台在这里指定它用哪个平台模型。
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
	// DefaultAssistantModel 是没显式配置助手模型时的默认选择：
	// 平台渠道里挂着的 DeepSeek V4.1 Flash（按模型名匹配，与渠道 ID 无关）。
	DefaultAssistantModel = "deepseek/deepseek-v4.1-flash"

	schemaVersion = 1
)

// ModelProfile 描述单个模型的能力与请求协议。
// Variants 让「同一个画布模型 + 不同生成模式」路由到不同的上游 SKU
// （服务端按请求的 operation / 参考素材数量等条件匹配，见 modelcatalog.SKUSelectorForIntent）。
type ModelProfile struct {
	Model       string `json:"model"`
	DisplayName string `json:"displayName,omitempty"`
	Icon        string `json:"icon,omitempty"`
	Capability  string `json:"capability"`
	Protocol    string `json:"protocol"`
	// ProviderModelKey 是没有任何变体命中时的回退上游模型名（留空则与 Model 同名）。
	ProviderModelKey string          `json:"providerModelKey,omitempty"`
	CapabilityConfig json.RawMessage `json:"capabilityConfig,omitempty"`
	Variants         []ModelVariant  `json:"variants,omitempty"`
}

// canonicalSelectorKey 把选择器键规范成服务端要求的写法（imageCount / videoSeconds 等驼峰）。
// 服务端只接受 operation / quality / size / vquality / videoSeconds / imageCount 六个键。
func canonicalSelectorKey(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "operation":
		return "operation"
	case "quality":
		return "quality"
	case "size":
		return "size"
	case "vquality":
		return "vquality"
	case "videoseconds":
		return "videoSeconds"
	case "imagecount":
		return "imageCount"
	default:
		return ""
	}
}

// ModelVariant 是「模式 → 上游 SKU」的一条映射。
// Selector 可用键（服务端校验）：operation / quality / size / vquality / videoSeconds / imageCount。
type ModelVariant struct {
	Selector         map[string]string `json:"selector,omitempty"`
	Operation        string            `json:"operation,omitempty"`
	ProviderModelKey string            `json:"providerModelKey"`
	Resolution       string            `json:"resolution,omitempty"`
	VideoSeconds     int               `json:"videoSeconds,omitempty"`
	Enabled          *bool             `json:"enabled,omitempty"`
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
	Version int `json:"version"`
	// AssistantModel 是画布助手使用的平台模型（`channelId::model` 或裸模型名）；
	// 留空表示按 DefaultAssistantModel 自动挑选。
	AssistantModel string `json:"assistantModel,omitempty"`
	// FeatureModels 是「画布功能 → 平台模型」的映射（功能键见 FeatureKeys）。
	// 平台内置好这些模型后，画布各功能直接取用，用户不需要自己选模型。
	FeatureModels map[string]string `json:"featureModels,omitempty"`
	Channels      []Channel         `json:"channels"`
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

// seedanceCapabilityConfigBody 生成 Seedance 视频模型的能力配置。
// 上游 ZhenZhen AI 按「档位 + 模式」拆分 SKU（t2v / i2v / multi），因此每个模式
// 单独一个画布模型，能力配置里的操作与参考素材限制也按模式区分。
// 数值口径与前端 lib/model-capabilities.ts 的 seedance-2 + newapi 分支一致。
// seedanceModeForModel 从上游 SKU 名推断生成模式：
// t2v 文生视频 / i2v 图生视频 / multi、r2v 多素材参考 / 其余按全能处理。
func seedanceModeForModel(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(name, "-t2v"):
		return "t2v"
	case strings.Contains(name, "-i2v"):
		return "i2v"
	case strings.Contains(name, "-multi"), strings.Contains(name, "-r2v"):
		return "multi"
	default:
		return "all"
	}
}

func seedanceDisplayName(model, mode string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	tier := "标准"
	switch {
	case strings.Contains(name, "global-fast"):
		tier = "海外快速"
	case strings.Contains(name, "global-mini"):
		tier = "海外迷你"
	case strings.Contains(name, "global-standard"):
		tier = "海外标准"
	case strings.Contains(name, "fast"):
		tier = "快速"
	case strings.Contains(name, "mini"):
		tier = "迷你"
	case strings.Contains(name, "2.5"):
		tier = "2.5 标准"
	}
	label := map[string]string{"t2v": "文生视频", "i2v": "图生视频", "multi": "多素材参考", "all": "全能参考"}[mode]
	return "Seedance " + label + "（" + tier + "）"
}

// VideoCapabilityConfigForModel 按上游 SKU 名生成视频能力配置。
// 第二个返回值为 false 表示不是 Seedance 2 家族（调用方回落到通用视频默认值）。
func VideoCapabilityConfigForModel(model string) (json.RawMessage, bool) {
	name := strings.ToLower(strings.TrimSpace(model))
	if !strings.Contains(name, "seedance-2") {
		return nil, false
	}
	return seedanceCapabilityConfigBody(seedanceModeForModel(name)), true
}

func seedanceCapabilityConfigBody(mode string) []byte {
	references := map[string]any{
		"promptMaxChars": 4000, "minImages": 0, "maxImages": 0, "maxImageBytes": 31457280,
		"maxVideos": 0, "maxVideoBytes": 0, "maxVideoDurationSeconds": 0,
		"maxAudios": 0, "maxAudioBytes": 0, "maxAudioDurationSeconds": 0,
	}
	operations := []string{"text_to_video"}
	defaultOperation := "text_to_video"
	switch mode {
	case "i2v":
		references["minImages"] = 1
		references["maxImages"] = 2
		operations = []string{"image_to_video", "first_last_frame"}
		defaultOperation = "image_to_video"
	case "multi", "all":
		references["maxImages"] = 9
		references["maxVideos"] = 3
		references["maxVideoBytes"] = 209715200
		references["maxVideoDurationSeconds"] = 15
		references["minVideoDurationSeconds"] = 2
		references["maxVideoTotalDurationSeconds"] = 15
		references["maxAudios"] = 3
		references["maxAudioBytes"] = 15728640
		references["maxAudioDurationSeconds"] = 15
		references["minAudioDurationSeconds"] = 1.8
		references["maxAudioTotalDurationSeconds"] = 15
		references["minImageWidth"], references["maxImageWidth"] = 300, 6000
		references["minImageHeight"], references["maxImageHeight"] = 300, 6000
		references["minImageAspect"], references["maxImageAspect"] = 0.4, 2.5
		references["minVideoWidth"], references["maxVideoWidth"] = 300, 6000
		references["minVideoHeight"], references["maxVideoHeight"] = 300, 6000
		references["minVideoAspect"], references["maxVideoAspect"] = 0.4, 2.5
		references["minVideoPixels"], references["maxVideoPixels"] = 409600, 8295044
		operations = []string{"image_to_video", "first_last_frame", "reference_to_video"}
		defaultOperation = "reference_to_video"
	}
	if mode == "all" {
		operations = []string{"text_to_video", "image_to_video", "first_last_frame", "reference_to_video"}
		defaultOperation = "text_to_video"
	}
	config := map[string]any{
		"version": 1,
		"video": map[string]any{
			"references":        references,
			"duration":          map[string]any{"selection": "range", "min": 1, "max": 15, "step": 1, "default": 6},
			"ratios":            []string{"adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
			"defaultRatio":      "16:9",
			"resolutions":       []string{"480p", "720p", "1080p"},
			"defaultResolution": "720p",
			"generateAudio":     map[string]any{"supported": true, "default": true},
			"watermark":         map[string]any{"supported": false, "default": false},
			"operations":        operations,
			"defaultOperation":  defaultOperation,
		},
	}
	body, err := json.Marshal(config)
	if err != nil {
		return nil
	}
	return body
}

// 通用能力配置模板（文本 / 图片 / 通用视频）：口径与前端 lib/model-capabilities.ts 的默认值一致。
const defaultTextCapabilityConfig = `{
  "version": 1,
  "text": {
    "streaming": true,
    "references": { "promptMaxChars": 32000, "maxImages": 0, "maxImageBytes": 0, "maxVideos": 0, "maxVideoBytes": 0 }
  }
}`

const defaultImageCapabilityConfig = `{
  "version": 1,
  "image": {
    "references": { "promptMaxChars": 32000, "maxImages": 16, "maxImageBytes": 31457280, "maskSupported": false },
    "size": {
      "parameter": "aspect_ratio",
      "values": ["1:1", "16:9", "9:16", "4:3", "3:4"],
      "default": "1:1",
      "allowCustom": false,
      "presets": [
        { "tier": "1k", "ratio": "1:1", "width": 1024, "height": 1024, "size": "1024x1024" },
        { "tier": "1k", "ratio": "16:9", "width": 1280, "height": 720, "size": "1280x720" },
        { "tier": "1k", "ratio": "9:16", "width": 720, "height": 1280, "size": "720x1280" },
        { "tier": "1k", "ratio": "4:3", "width": 1152, "height": 864, "size": "1152x864" },
        { "tier": "1k", "ratio": "3:4", "width": 864, "height": 1152, "size": "864x1152" },
        { "tier": "2k", "ratio": "1:1", "width": 2048, "height": 2048, "size": "2048x2048" },
        { "tier": "2k", "ratio": "16:9", "width": 2048, "height": 1152, "size": "2048x1152" },
        { "tier": "2k", "ratio": "9:16", "width": 1152, "height": 2048, "size": "1152x2048" },
        { "tier": "2k", "ratio": "4:3", "width": 2048, "height": 1536, "size": "2048x1536" },
        { "tier": "2k", "ratio": "3:4", "width": 1536, "height": 2048, "size": "1536x2048" },
        { "tier": "4k", "ratio": "1:1", "width": 2880, "height": 2880, "size": "2880x2880" },
        { "tier": "4k", "ratio": "16:9", "width": 3840, "height": 2160, "size": "3840x2160" },
        { "tier": "4k", "ratio": "9:16", "width": 2160, "height": 3840, "size": "2160x3840" },
        { "tier": "4k", "ratio": "4:3", "width": 3264, "height": 2448, "size": "3264x2448" },
        { "tier": "4k", "ratio": "3:4", "width": 2448, "height": 3264, "size": "2448x3264" }
      ]
    },
    "quality": { "supported": true, "values": ["1k", "2k", "4k"], "default": "1k" },
    "transparentBackground": { "supported": false, "default": false },
    "responseFormat": { "supported": true },
    "outputFormat": { "supported": true },
    "maxOutputs": 4
  }
}`

const defaultVideoCapabilityConfig = `{
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
    "operations": ["text_to_video", "image_to_video", "reference_to_video"],
    "defaultOperation": "text_to_video"
  }
}`

// CapabilityConfigFor 返回模型能力配置：视频按模型名细分（Seedance 家族按 t2v/i2v/multi），
// 图片与文本使用通用模板，音频能力不需要能力配置（返回空且 ok=true）。
func CapabilityConfigFor(capability, model string) (json.RawMessage, bool) {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "video":
		name := strings.ToLower(strings.TrimSpace(model))
		if strings.Contains(name, "seedance-2") {
			return seedanceCapabilityConfigBody(seedanceModeForModel(model)), true
		}
		// MiniMax H3 支持参考视频/参考音频（reference_audio / drive_audio）。
		// 以前它落到通用视频默认值（maxAudios/maxVideos = 0），客户端的模型列表据此
		// 把 H3 灰掉、发送按钮点不动；DB channel_models 里一直是 3/3，种子却写 0。
		if isMiniMaxH3Model(name) {
			return minimaxH3CapabilityConfigBody(), true
		}
		return json.RawMessage(defaultVideoCapabilityConfig), true
	case "image":
		return json.RawMessage(defaultImageCapabilityConfig), true
	case "text":
		return json.RawMessage(defaultTextCapabilityConfig), true
	case "audio":
		return nil, true
	default:
		return nil, false
	}
}

func isMiniMaxH3Model(name string) bool {
	return strings.Contains(name, "minimax-h3") || strings.Contains(name, "minimax h3") ||
		strings.Contains(name, "h3-max") || strings.Contains(name, "h3 max")
}

// minimaxH3CapabilityConfigBody 与 channel_models(MiniMax-H3) 的权威配置保持一致。
func minimaxH3CapabilityConfigBody() json.RawMessage {
	body := map[string]any{
		"version": 1,
		"video": map[string]any{
			"references": map[string]any{
				"promptMaxChars": 4000,
				"minImages":      0, "maxImages": 9, "maxImageBytes": 31457280,
				"maxVideos": 3, "maxVideoBytes": 209715200, "maxVideoDurationSeconds": 0,
				"maxAudios": 3, "maxAudioBytes": 15728640, "maxAudioDurationSeconds": 0,
			},
			"duration":          map[string]any{"selection": "range", "min": 4, "max": 15, "step": 1, "default": 5},
			"ratios":            []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
			"defaultRatio":      "16:9",
			"resolutions":       []string{"480p", "768p", "1080p"},
			"defaultResolution": "768p",
			"generateAudio":     map[string]any{"supported": false, "default": false},
			"watermark":         map[string]any{"supported": false, "default": false},
			"operations":        []string{"text_to_video", "image_to_video", "reference_to_video", "first_last_frame"},
			"defaultOperation":  "text_to_video",
		},
	}
	raw, _ := json.Marshal(body)
	return json.RawMessage(raw)
}

// seedanceFamilyProfile 生成「家族模型 + 模式变体」预置条目：
// 画布上只出现一个模型（display 可自定义），生成模式（文生/图生/参考）由变体路由到上游 SKU。
func seedanceFamilyProfile(family, display string) ModelProfile {
	return ModelProfile{
		Model: family, DisplayName: display, Capability: "video", Protocol: "newapi",
		ProviderModelKey: family + "-t2v",
		CapabilityConfig: seedanceCapabilityConfigBody("all"),
		// 变体按「用户选的生成模式」匹配（服务端不再按参考素材数量反推模式）：
		// 图生视频（首帧）与首尾帧（首帧+尾帧）都落到上游 i2v 档，靠参考图数量区分；
		// 全能参考无论几张参考图都落到多模态 multi 档。
		Variants: []ModelVariant{
			{Operation: "text_to_video", ProviderModelKey: family + "-t2v"},
			{Operation: "image_to_video", ProviderModelKey: family + "-i2v"},
			{Operation: "first_last_frame", ProviderModelKey: family + "-i2v"},
			{Operation: "reference_to_video", ProviderModelKey: family + "-multi"},
			{Operation: "video_to_video", ProviderModelKey: family + "-multi"},
		},
	}
}

// platformProfile 用通用能力配置构造一个模型条目。
func platformProfile(model, displayName, capability, protocol string) ModelProfile {
	profile := ModelProfile{Model: model, DisplayName: displayName, Capability: capability, Protocol: protocol, ProviderModelKey: model}
	if body, ok := CapabilityConfigFor(capability, model); ok {
		profile.CapabilityConfig = body
	}
	return profile
}

// Defaults 是首次部署预置的渠道模板：上游 ZhenZhen AI（api.seedance.nz）。
// 视频走 OpenAI Videos（newapi，POST /v1/videos），图片走 Gemini generateContent
// （gemini-image，POST /v1beta/models/{model}:generateContent），文本走 chat/completions。
func Defaults() []Channel {
	profiles := []ModelProfile{
		seedanceFamilyProfile("seedance-2.0-standard", "Seedance 2.0 标准"),
		seedanceFamilyProfile("seedance-2.0-fast", "Seedance 2.0 快速"),
		seedanceFamilyProfile("seedance-2.5-standard", "Seedance 2.5 标准"),
		platformProfile("MiniMax-H3", "MiniMax H3", "video", "minimax-h3-v2"),
		platformProfile("zhenzhen-image-nb-2.1-lowprice", "zhenzhen nb 2.1（特价）", "image", "newapi-image"),
		platformProfile("zhenzhen-image-nb-pro-lowprice", "zhenzhen nb pro（特价）", "image", "newapi-image"),
		platformProfile("zhenzhen-image-g-v2.5-lowprice", "zhenzhen g v2.5（特价）", "image", "newapi-image"),
		platformProfile("deepseek/deepseek-v4.1-flash", "DeepSeek V4.1 Flash", "text", "chat-completion"),
		platformProfile("zhenzhen/g6-sol", "zhenzhen g6-sol", "text", "chat-completion"),
		platformProfile("zhenzhen/g6-astra", "zhenzhen g6-astra", "text", "chat-completion"),
		platformProfile("glm/glm-5.3-flash", "GLM 5.3 Flash", "text", "chat-completion"),
	}
	models := make([]string, 0, len(profiles))
	for _, profile := range profiles {
		models = append(models, profile.Model)
	}
	return []Channel{{
		ID:               ChannelIDPrefix + "seedance",
		Name:             "灵动TV 平台模型",
		BaseURL:          "https://api.seedance.nz",
		APIFormat:        "openai",
		Models:           models,
		ModelProfiles:    profiles,
		ConcurrencyLimit: 3,
		Enabled:          true,
		SortOrder:        10,
	}}
}

// List 读取平台渠道；文件不存在时返回预置模板（不落盘，便于观测）。
func (s *Store) List() ([]Channel, error) {
	channels, _, err := s.Config()
	return channels, err
}

// AssistantModel 读取平台配置的助手模型；空表示按 DefaultAssistantModel 自动挑选。
func (s *Store) AssistantModel() (string, error) {
	_, assistantModel, err := s.Config()
	return assistantModel, err
}

// FeatureKeys 是「功能 → 模型」映射里允许的功能键（顺序即后台展示顺序）。
// 键的生命周期由画布功能决定，后台只负责给每个功能挑一个平台模型。
var FeatureKeys = []string{
	"text.chat",    // 文本生成（含反推提示词，需要能读图的文本模型）
	"image.t2i",    // 文生图
	"image.edit",   // 图片编辑（图生图 / 表情调整 / 质感调整 / 多角度 / 打光）
	"video.t2v",    // 视频 · 文生视频
	"video.i2v",    // 视频 · 图生视频 / 首尾帧
	"video.multi",  // 视频 · 全能参考
	"audio.tts",    // 音频 · 语音合成（配音）
	"audio.music",  // 音频 · 音乐 / BGM（mureka / minimax 音乐档）
	"audio.sfx",    // 音频 · 音效（Suno sounds）
	"image.vision", // 图片理解（反推提示词等，留空表示跟随 text.chat）
}

// FeatureModels 读取「功能 → 模型」映射（只返回已知功能键）。
func (s *Store) FeatureModels() (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	decoded, err := s.loadDocumentLocked()
	if err != nil {
		return nil, err
	}
	result := make(map[string]string, len(decoded.FeatureModels))
	for _, key := range FeatureKeys {
		if value := strings.TrimSpace(decoded.FeatureModels[key]); value != "" {
			result[key] = value
		}
	}
	return result, nil
}

// Config 一次读出渠道定义与助手模型，避免管理端回显时分两次读同一份文件。
func (s *Store) Config() ([]Channel, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	decoded, err := s.loadDocumentLocked()
	if err != nil {
		return nil, "", err
	}
	channels := make([]Channel, 0, len(decoded.Channels))
	for _, item := range decoded.Channels {
		normalized, normalizeErr := normalize(item)
		if normalizeErr != nil {
			return nil, "", normalizeErr
		}
		channels = append(channels, normalized)
	}
	return channels, strings.TrimSpace(decoded.AssistantModel), nil
}

// loadDocumentLocked 读取整份文档；文件不存在时返回预置模板（不落盘，便于观测）。
func (s *Store) loadDocumentLocked() (document, error) {
	body, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return document{Version: schemaVersion, Channels: Defaults()}, nil
	}
	if err != nil {
		return document{}, fmt.Errorf("读取平台渠道配置失败: %w", err)
	}
	var decoded document
	if err := json.Unmarshal(body, &decoded); err != nil {
		return document{}, fmt.Errorf("平台渠道配置损坏: %w", err)
	}
	return decoded, nil
}

// Save 整体替换平台渠道定义。密钥提交脱敏标记（MaskedSecret）表示沿用已保存的密钥，
// 留空表示清除密钥（便于运维显式清空已泄露的凭证）。
func (s *Store) Save(incoming []Channel) ([]Channel, error) {
	return s.SaveWithAssistantModel(incoming, nil)
}

// SaveWithAssistantModel 整体替换渠道定义，并可同时更新助手模型。
// assistantModel 为 nil 表示保持原值（兼容不带该字段的老管理端）。
func (s *Store) SaveWithAssistantModel(incoming []Channel, assistantModel *string) ([]Channel, error) {
	return s.SaveAll(incoming, assistantModel, nil)
}

// SaveAll 同时更新渠道、助手模型与「功能 → 模型」映射。
// featureModels 为 nil 表示保持原值；空串值表示清除该功能的绑定。
func (s *Store) SaveAll(incoming []Channel, assistantModel *string, featureModels map[string]string) ([]Channel, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, err := s.loadDocumentLocked()
	if err != nil {
		return nil, err
	}
	existing := stored.Channels
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
	assistant := strings.TrimSpace(stored.AssistantModel)
	if assistantModel != nil {
		assistant = strings.TrimSpace(*assistantModel)
	}
	features := stored.FeatureModels
	if featureModels != nil {
		if features == nil {
			features = map[string]string{}
		}
		for _, key := range FeatureKeys {
			value, present := featureModels[key]
			if !present {
				continue
			}
			if value = strings.TrimSpace(value); value == "" {
				delete(features, key)
				continue
			}
			features[key] = value
		}
		if len(features) == 0 {
			features = nil
		}
	}
	if err := s.writeLocked(next, assistant, features); err != nil {
		return nil, err
	}
	return next, nil
}

func (s *Store) writeLocked(channels []Channel, assistantModel string, featureModels map[string]string) error {
	body, err := json.MarshalIndent(document{Version: schemaVersion, AssistantModel: assistantModel, FeatureModels: featureModels, Channels: channels}, "", "  ")
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
	for index := range result.ModelProfiles {
		variants := make([]ModelVariant, 0, len(result.ModelProfiles[index].Variants))
		for _, variant := range result.ModelProfiles[index].Variants {
			selector := make(map[string]string, len(variant.Selector)+1)
			for key, value := range variant.Selector {
				key = canonicalSelectorKey(key)
				value = strings.TrimSpace(value)
				if key != "" && value != "" {
					selector[key] = value
				}
			}
			if operation := strings.ToLower(strings.TrimSpace(variant.Operation)); operation != "" {
				selector["operation"] = operation
			}
			providerModelKey := strings.TrimSpace(variant.ProviderModelKey)
			if providerModelKey == "" || len(selector) == 0 {
				continue
			}
			entry := variant
			entry.Selector = selector
			entry.Operation = ""
			entry.ProviderModelKey = providerModelKey
			variants = append(variants, entry)
		}
		result.ModelProfiles[index].Variants = variants
	}
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
