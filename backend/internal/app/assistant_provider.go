package app

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"infinite-canvas/backend/internal/assistant"
	"infinite-canvas/backend/internal/beefapi"
	"infinite-canvas/backend/internal/modelcatalog"
	"infinite-canvas/backend/internal/platformchannels"
	"infinite-canvas/backend/internal/workspace"
)

const (
	AssistantReasonModelNotConfigured  = assistant.ReasonModelNotConfigured
	AssistantReasonCredentialMissing   = assistant.ReasonCredentialMissing
	AssistantReasonProtocolUnsupported = assistant.ReasonProtocolUnsupported
)

type AssistantUnavailableError = assistant.UnavailableError
type AssistantProvider = assistant.Provider

func assistantUnavailable(reason, message string) error {
	return modelcatalog.AssistantUnavailable(reason, message)
}

type assistantModelProfile = modelcatalog.AssistantModelProfile
type assistantChannel = modelcatalog.AssistantChannel
type assistantConfigSnapshot = modelcatalog.AssistantConfigSnapshot

func (s *Service) assistantConfig() (assistantConfigSnapshot, error) {
	var snapshot assistantConfigSnapshot
	store, err := workspace.NewProviderConfig(s.dataDir)
	if err != nil {
		return snapshot, err
	}
	effective, _, err := store.LoadEffectiveModelConfig()
	if err != nil {
		return snapshot, assistantUnavailable(AssistantReasonModelNotConfigured, "本地模型配置不可读")
	}
	body, err := json.Marshal(effective.Config)
	if err != nil {
		return snapshot, err
	}
	if len(body) == 0 {
		return snapshot, assistantUnavailable(AssistantReasonModelNotConfigured, "本地模型配置为空")
	}
	if err := json.Unmarshal(body, &snapshot); err != nil {
		return snapshot, assistantUnavailable(AssistantReasonModelNotConfigured, "本地模型配置无法解析")
	}
	snapshot.Revision = effective.Revision
	return snapshot, nil
}

func (s *Service) ResolveAssistantProvider() (AssistantProvider, error) {
	snapshot, err := s.assistantConfig()
	if err != nil {
		return AssistantProvider{}, err
	}
	// 平台统一渠道只注入给浏览器，本地模型配置里没有它们；助手是在服务端解析模型的，
	// 不补这一步助手永远报 model_not_configured。
	if platform := s.platformAssistantChannels(); len(platform) > 0 {
		snapshot.Channels = append(platform, snapshot.Channels...)
		if model := s.platformAssistantModel(platform); model != "" {
			snapshot.AssistantModel = model
		}
	}
	for index, channel := range snapshot.Channels {
		if strings.TrimSpace(channel.Name) == "" && channel.ID == beefapi.ChannelID {
			snapshot.Channels[index].Name = "BeefAPI"
		}
	}
	return modelcatalog.ResolveAssistantProvider(snapshot, s.assistantManagedCredentialLookup())
}

// platformAssistantChannels 把平台统一渠道转换成助手渠道快照。
//
// 与浏览器侧的区别只有一处：这里必须带真实密钥（助手的模型请求由宿主发出，
// 不经过 /api/ai/custom 中转），因此绝不能把结果下发到浏览器。
// 助手只走文本协议，其它能力的模型照样列出（能力判定由 modelcatalog 负责）。
func (s *Service) platformAssistantChannels() []assistantChannel {
	store, err := platformchannels.New(s.dataDir)
	if err != nil {
		logPlatformAssistantFailure(err)
		return nil
	}
	channels, err := store.List()
	if err != nil {
		logPlatformAssistantFailure(err)
		return nil
	}
	out := make([]assistantChannel, 0, len(channels))
	for _, channel := range channels {
		// 预置模板与「还没填密钥」的平台渠道不能工作：注入它们只会把助手的选择
		// 引到一个必然失败的渠道上（而且会盖掉本机已配好的文本模型）。
		if !channel.Enabled || strings.TrimSpace(channel.BaseURL) == "" || strings.TrimSpace(channel.APIKey) == "" {
			continue
		}
		models := make([]string, 0, len(channel.ModelProfiles))
		profiles := make([]assistantModelProfile, 0, len(channel.ModelProfiles))
		for _, profile := range channel.ModelProfiles {
			model := strings.TrimSpace(profile.Model)
			if model == "" {
				continue
			}
			capability := strings.TrimSpace(profile.Capability)
			protocol := strings.TrimSpace(profile.Protocol)
			// 文本能力未显式声明协议时按 chat-completion 处理，与前端
			// lib/assistant-model.ts 的默认口径一致。
			if protocol == "" && capability == "text" {
				protocol = "chat-completion"
			}
			models = append(models, model)
			profiles = append(profiles, assistantModelProfile{Model: model, Capability: capability, Protocol: protocol})
		}
		if len(models) == 0 {
			continue
		}
		out = append(out, assistantChannel{
			ID: channel.ID, Name: channel.Name, BaseURL: channel.BaseURL, APIKey: channel.APIKey,
			Enabled: true, Scope: "system", CredentialRef: platformchannels.CredentialRef,
			Models: models, ModelProfiles: profiles,
		})
	}
	return out
}

// platformAssistantModel 决定助手实际使用的模型：后台配置优先（支持裸模型名，
// 自动补齐渠道前缀），没配置时用平台渠道里的 DeepSeek V4.1 Flash，都没有则留空
// —— 留空表示回退到本地默认文本模型。
func (s *Service) platformAssistantModel(channels []assistantChannel) string {
	configured := ""
	if store, err := platformchannels.New(s.dataDir); err == nil {
		if value, readErr := store.AssistantModel(); readErr == nil {
			configured = value
		}
	}
	if configured != "" {
		if strings.Contains(configured, "::") {
			return configured
		}
		for _, channel := range channels {
			for _, model := range channel.Models {
				if model == configured {
					return channel.ID + "::" + model
				}
			}
		}
		return configured
	}
	for _, channel := range channels {
		for _, model := range channel.Models {
			if model == platformchannels.DefaultAssistantModel {
				return channel.ID + "::" + model
			}
		}
	}
	return ""
}

func logPlatformAssistantFailure(err error) {
	fmt.Fprintf(os.Stderr, "[canvas] 读取平台渠道（助手模型）失败: %v\n", err)
}

func (s *Service) assistantManagedCredentialLookup() modelcatalog.ManagedCredentialLookup {
	return func(channelID, credentialRef, baseURL string) (string, string, bool) {
		if !(beefapi.IsManagedChannel(channelID, credentialRef, baseURL) || channelID == beefapi.ChannelID) {
			return "", "", false
		}
		apiKey, resolvedBaseURL, _, _, lookupErr := s.lookupBeefAPICredential()
		if lookupErr != nil || strings.TrimSpace(apiKey) == "" {
			return "", "", false
		}
		return apiKey, resolvedBaseURL, true
	}
}

func assistantReasonMessage(reason string) string {
	return modelcatalog.AssistantReasonMessage(reason)
}

func (s *Service) resolveAssistantChannelModel(snapshot assistantConfigSnapshot, modelKey string) (AssistantProvider, string) {
	for index, channel := range snapshot.Channels {
		if strings.TrimSpace(channel.Name) == "" && channel.ID == beefapi.ChannelID {
			snapshot.Channels[index].Name = "BeefAPI"
		}
	}
	return modelcatalog.ResolveAssistantChannelModel(snapshot, modelKey, s.assistantManagedCredentialLookup())
}

func findAssistantChannel(channels []assistantChannel, channelID, modelID string) (assistantChannel, bool) {
	return modelcatalog.FindAssistantChannel(channels, channelID, modelID)
}

func channelModelProtocol(channel assistantChannel, modelID string) (string, bool) {
	return modelcatalog.ChannelModelProtocol(channel, modelID)
}

func assistantChannelName(channel assistantChannel) string {
	if name := modelcatalog.AssistantChannelName(channel); name != "" && name != channel.ID {
		return name
	}
	if channel.ID == beefapi.ChannelID {
		return "BeefAPI"
	}
	return modelcatalog.AssistantChannelName(channel)
}

func (s *Service) AssistantGenerationModel(kind string) (display string, modelKey string) {
	display, modelKey, _, _, _ = s.ResolveAssistantGenerationModel(kind, "")
	return display, modelKey
}

func (s *Service) AssistantGenerationModelSnapshot(kind string) (display string, modelKey string, revision int64, err error) {
	display, modelKey, revision, _, err = s.ResolveAssistantGenerationModel(kind, "")
	return
}

func (s *Service) ResolveAssistantGenerationModel(kind, selectedModel string) (display string, modelKey string, revision int64, kindMismatch bool, err error) {
	snapshot, err := s.assistantConfig()
	if err != nil {
		return "", "", 0, false, err
	}
	choice := modelcatalog.ResolveAssistantGenerationModel(snapshot, kind, selectedModel)
	return choice.Display, choice.ModelKey, snapshot.Revision, choice.KindMismatch, nil
}
