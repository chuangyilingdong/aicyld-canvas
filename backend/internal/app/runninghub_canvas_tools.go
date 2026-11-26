package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	localasset "infinite-canvas/backend/internal/asset"
	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/topaz"
)

const (
	runningHubToolUpscaleOperation  = "media.upscale.runninghub"
	runningHubToolSubtitleOperation = "media.video.subtitle_erase.runninghub"
)

type runningHubCanvasToolModel struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Endpoint        string `json:"endpoint"`
	Capability      string `json:"capability"`
	ChannelID       string `json:"channelId"`
	ChannelModelKey string `json:"channelModelKey"`
	Protocol        string `json:"protocol"`
	BillingSummary  string `json:"billingSummary"`
}

func (s *Service) runningHubCanvasToolModels(capability string) []runningHubCanvasToolModel {
	if s == nil || s.repo == nil {
		return nil
	}
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return nil
	}
	allowed := map[string]string{}
	switch capability {
	case "image":
		allowed[generation.RunningHubImageUpscaleEndpoint] = "runninghub-standard-image"
	case "video":
		allowed[generation.RunningHubVideoUpscaleEndpoint] = "runninghub-standard-video"
		allowed[generation.RunningHubSubtitleEraseEndpoint] = "runninghub-standard-video"
		allowed[generation.RunningHubSubtitleEraseProEndpoint] = "runninghub-standard-video"
	case "subtitle":
		allowed[generation.RunningHubSubtitleEraseEndpoint] = "runninghub-standard-video"
		allowed[generation.RunningHubSubtitleEraseProEndpoint] = "runninghub-standard-video"
	default:
		return nil
	}
	result := make([]runningHubCanvasToolModel, 0)
	for _, channel := range channels {
		models, listErr := s.repo.ChannelModels(channel.ID, false)
		if listErr != nil {
			continue
		}
		for _, item := range models {
			endpoint := strings.TrimPrefix(strings.TrimSpace(kernel.FirstNonEmpty(item.ProviderModelKey, item.ModelKey)), "/")
			expectedProtocol := allowed[endpoint]
			if !item.Enabled || expectedProtocol == "" || string(item.Protocol) != expectedProtocol {
				continue
			}
			if !runningHubToolSiteMatches(channel.BaseURL, endpoint) {
				continue
			}
			label := strings.TrimSpace(item.DisplayName)
			if label == "" {
				label = endpoint
			}
			result = append(result, runningHubCanvasToolModel{
				ID: item.ModelKey, Label: label, Endpoint: endpoint, Capability: strings.TrimSpace(kernel.FirstNonEmpty(item.Capability, capability)),
				ChannelID: channel.ID, ChannelModelKey: item.ModelKey, Protocol: expectedProtocol,
				BillingSummary: runningHubToolBillingSummary(endpoint),
			})
		}
	}
	return result
}

func runningHubToolSiteMatches(baseURL, endpoint string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if endpoint == generation.RunningHubImageUpscaleEndpoint {
		return host == "www.runninghub.ai" || host == "runninghub.ai"
	}
	return host == "www.runninghub.cn" || host == "runninghub.cn"
}

func runningHubToolBillingSummary(endpoint string) string {
	switch endpoint {
	case generation.RunningHubImageUpscaleEndpoint:
		return "按超分后的输出像素预扣，完成后按实际账单结算"
	case generation.RunningHubVideoUpscaleEndpoint:
		return "按视频时长和增强档位预扣，完成后按实际账单结算"
	default:
		return "按源视频实际时长预扣，完成后按实际账单结算"
	}
}

func (s *Service) resolveRunningHubCanvasToolConfig(channelID, channelModelKey, capability string) (generation.Config, *model.ChannelModel, error) {
	modelKey := strings.TrimSpace(channelModelKey)
	if modelKey == "" {
		return generation.Config{}, nil, kernel.BadAuthRequest("请选择 RunningHub 媒体工具模型")
	}
	channelModel, err := s.repo.ChannelModelByKey(strings.TrimSpace(channelID), modelKey)
	if err != nil || channelModel == nil || !channelModel.Enabled {
		return generation.Config{}, nil, kernel.BadAuthRequest("RunningHub 媒体工具模型不存在或已停用")
	}
	expectedProtocol := model.ChannelInterfaceRunningHubStandardVideo
	if capability == "image" {
		expectedProtocol = model.ChannelInterfaceRunningHubStandardImage
	}
	if channelModel.Protocol != expectedProtocol || channelModel.Capability != capability {
		return generation.Config{}, nil, kernel.BadAuthRequest("RunningHub 媒体工具模型能力与素材类型不匹配")
	}
	config, err := s.resolveProviderConfig(providerConfig{
		ChannelID: strings.TrimSpace(channelID), ChannelModelKey: modelKey, Model: modelKey,
	})
	if err != nil {
		return generation.Config{}, nil, err
	}
	endpoint := strings.TrimPrefix(strings.TrimSpace(kernel.FirstNonEmpty(channelModel.ProviderModelKey, channelModel.ModelKey)), "/")
	if config.Model != endpoint || !runningHubToolEndpointAllowed(capability, endpoint) || !runningHubToolSiteMatches(config.BaseURL, endpoint) {
		return generation.Config{}, nil, kernel.BadAuthRequest("所选 RunningHub 模型不是受支持的媒体工具")
	}
	return config, channelModel, nil
}

func runningHubToolEndpointAllowed(capability, endpoint string) bool {
	switch capability {
	case "image":
		return endpoint == generation.RunningHubImageUpscaleEndpoint
	case "video":
		return endpoint == generation.RunningHubVideoUpscaleEndpoint ||
			endpoint == generation.RunningHubSubtitleEraseEndpoint ||
			endpoint == generation.RunningHubSubtitleEraseProEndpoint
	default:
		return false
	}
}

func managedToolResource(ctx context.Context, s *Service, userID, resourceID, expectedKind string) (*model.Resource, error) {
	resource, err := s.EnsureResourceMediaMetadata(ctx, userID, strings.TrimSpace(resourceID))
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return nil, kernel.BadAuthRequest("输入素材不存在或未就绪")
	}
	if localasset.NormalizeKind(resource.Kind, resource.MimeType) != expectedKind {
		return nil, kernel.BadAuthRequest("RunningHub 媒体工具的素材类型不匹配")
	}
	return resource, nil
}

func runningHubManagedToolBillingFacts(operation string, config generation.Config, resource *model.Resource, scale int, enhancementModel string) billing.ManagedToolFacts {
	endpoint := strings.TrimPrefix(strings.TrimSpace(kernel.FirstNonEmpty(config.ProviderModelKey, config.Model)), "/")
	return billing.ManagedToolFacts{
		Operation: operation, ModelKey: endpoint, DisplayName: endpoint,
		SourceDurationMs: resource.DurationMs, SourceWidth: resource.Width, SourceHeight: resource.Height,
		Scale: scale, EnhancementModel: enhancementModel,
	}
}

func managedToolQuoteResponse(quote *billing.BillingQuote, resource *model.Resource, mediaType string, scale float64) map[string]any {
	if quote == nil {
		return nil
	}
	chargeYuan := float64(quote.Points) * quotePointValue(quote)
	source := map[string]any{"width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}
	result := map[string]any{
		"mediaType": mediaType, "source": source, "reservation": chargeYuan, "currency": "CNY",
		"points": quote.Points, "estimatedCostCny": quote.EstimatedCostCNY,
		"billingMode": "runninghub_managed_tool", "billingSummary": "预计先扣 " + fmt.Sprintf("%d 积分（¥%.2f）", quote.Points, chargeYuan),
		"generationSubmitted": false, "cloudProcessing": true,
	}
	if mediaType == "image" {
		result["output"] = map[string]any{
			"width": int(float64(resource.Width) * scale), "height": int(float64(resource.Height) * scale),
		}
	}
	return result
}

func quotePointValue(quote *billing.BillingQuote) float64 {
	if quote.Points <= 0 {
		return 0
	}
	// The pricing service returns the equivalent charge in its quote breakdown.
	if value, ok := quote.Breakdown["pointValueYuan"].(float64); ok && value > 0 {
		return value
	}
	if value, ok := quote.Breakdown["pointValueYuan"].(int); ok && value > 0 {
		return float64(value)
	}
	return 0.1
}

func runningHubUpscaleInput(ctx context.Context, s *Service, userID string, request topaz.Request) (generation.Input, *model.Resource, *model.ChannelModel, error) {
	var empty generation.Input
	if strings.TrimSpace(request.Mode) != "precision" {
		return empty, nil, nil, kernel.BadAuthRequest("当前 RunningHub 媒体工具仅支持保真超分模式")
	}
	resource, err := s.EnsureResourceMediaMetadata(ctx, userID, strings.TrimSpace(request.ResourceID))
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return empty, nil, nil, kernel.BadAuthRequest("输入素材不存在或未就绪")
	}
	kind := localasset.NormalizeKind(resource.Kind, resource.MimeType)
	if kind != "image" && kind != "video" {
		return empty, nil, nil, kernel.BadAuthRequest("超分素材类型无效")
	}
	config, channelModel, err := s.resolveRunningHubCanvasToolConfig(request.ChannelID, request.ChannelModelKey, kind)
	if err != nil {
		return empty, nil, nil, err
	}
	endpoint := config.Model
	if (kind == "image" && endpoint != generation.RunningHubImageUpscaleEndpoint) ||
		(kind == "video" && endpoint != generation.RunningHubVideoUpscaleEndpoint) {
		return empty, nil, nil, kernel.BadAuthRequest("所选模型不是该素材类型的 RunningHub 超分工具")
	}
	scale := int(request.Scale)
	if request.Scale != float64(scale) {
		return empty, nil, nil, kernel.BadAuthRequest("画布 RunningHub 超分倍率必须为整数")
	}
	if endpoint == generation.RunningHubImageUpscaleEndpoint && scale != 2 && scale != 4 {
		return empty, nil, nil, kernel.BadAuthRequest("画布图片超分仅支持 2x 或 4x")
	}
	if endpoint == generation.RunningHubVideoUpscaleEndpoint && (scale < 1 || scale > 4) {
		return empty, nil, nil, kernel.BadAuthRequest("画布视频超分倍率须为 1 至 4 的整数")
	}
	format := strings.ToLower(strings.TrimSpace(request.OutputFormat))
	if kind == "image" && format != "" && format != "png" && format != "jpeg" {
		return empty, nil, nil, kernel.BadAuthRequest("图片输出格式仅支持 PNG 或 JPEG")
	}
	input := generation.Input{
		Mode: kind, Prompt: "RunningHub AI 超分", Config: config,
		Upscale:  &generation.UpscaleOptions{Factor: scale, OutputFormat: format},
		Metadata: map[string]any{"managedToolBilling": map[string]any{"enhancementModel": strings.ToLower(strings.TrimSpace(request.EnhancementModel)), "scale": scale}},
	}
	input.Config.Model = channelModel.ModelKey
	media := generation.Media{
		StorageKey: "resource:" + resource.ID, MimeType: resource.MimeType,
		Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs,
	}
	if kind == "image" {
		input.ReferenceImages = []generation.Media{media}
	} else {
		model := strings.ToLower(strings.TrimSpace(request.EnhancementModel))
		if model == "" {
			model = "max"
		}
		if model != "max" && model != "high" && model != "medium" && model != "low" {
			return empty, nil, nil, kernel.BadAuthRequest("视频超分增强档位无效")
		}
		input.Config.Quality = model
		input.Metadata["managedToolBilling"].(map[string]any)["enhancementModel"] = model
		input.ReferenceVideos = []generation.Media{media}
	}
	return input, resource, channelModel, nil
}

func runningHubSubtitleInput(ctx context.Context, s *Service, userID string, request generation.SubtitleEraseRequest) (generation.Input, *model.Resource, *model.ChannelModel, error) {
	var empty generation.Input
	resource, err := managedToolResource(ctx, s, userID, request.ResourceID, "video")
	if err != nil {
		return empty, nil, nil, err
	}
	config, channelModel, err := s.resolveRunningHubCanvasToolConfig(request.ChannelID, request.ChannelModelKey, "video")
	if err != nil {
		return empty, nil, nil, err
	}
	if config.Model != generation.RunningHubSubtitleEraseEndpoint && config.Model != generation.RunningHubSubtitleEraseProEndpoint {
		return empty, nil, nil, kernel.BadAuthRequest("所选模型不是 RunningHub 字幕擦除工具")
	}
	if request.EraseMethod != "" && request.EraseMethod != "auto" {
		return empty, nil, nil, kernel.BadAuthRequest("RunningHub 字幕擦除仅支持自动识别模式")
	}
	input := generation.Input{
		Mode: "video", Prompt: "RunningHub 视频去字幕", Config: config,
		SubtitleErase: &generation.SubtitleEraseOptions{EraseMethod: "auto", SubtitleModel: "standard"},
		ReferenceVideos: []generation.Media{{
			StorageKey: "resource:" + resource.ID, MimeType: resource.MimeType,
			Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs,
		}},
		Metadata: map[string]any{"managedToolBilling": map[string]any{}},
	}
	input.Config.Model = channelModel.ModelKey
	return input, resource, channelModel, nil
}

func buildManagedToolTaskPayload(input generation.Input, operation, clientOperationID, nodeID string) (map[string]any, error) {
	input.Metadata["source"] = "canvas"
	input.Metadata["operation"] = operation
	input.Metadata["clientOperationId"] = clientOperationID
	input.Metadata["nodeId"] = nodeID
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func runningHubToolPointQuote(ctx context.Context, s *Service, userID string, facts billing.ManagedToolFacts, resource *model.Resource, mediaType string, scale float64) (map[string]any, error) {
	if s.billing == nil || !s.billing.Enabled() {
		return map[string]any{
			"mediaType":   mediaType,
			"source":      map[string]any{"width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs},
			"reservation": 0, "currency": "CNY", "points": 0, "estimatedCostCny": 0,
			"generationSubmitted": false, "cloudProcessing": true,
		}, nil
	}
	quote, err := s.billing.QuoteManagedTool(ctx, userID, facts)
	if err != nil {
		return nil, err
	}
	return managedToolQuoteResponse(quote, resource, mediaType, scale), nil
}
