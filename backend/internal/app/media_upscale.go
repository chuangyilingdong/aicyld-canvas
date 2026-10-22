package app

import (
	"context"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/mediaupscale"
	"infinite-canvas/backend/internal/model"
)

type MediaUpscaleRequest = mediaupscale.Request

func (s *Service) upscaleConfig(name string) (generation.Config, error) {
	apiKey, baseURL, _, _, err := s.lookupBeefAPICredential()
	if err != nil {
		return generation.Config{}, err
	}
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(baseURL) == "" {
		return generation.Config{}, BadAuthRequest("请先连接官方算力账号")
	}
	return generation.Config{BaseURL: baseURL, APIFormat: "openai", InterfaceType: "newapi-channel-2", APIKey: apiKey, Model: name}, nil
}

func (s *Service) MediaUpscaleCapabilities() map[string]any {
	return mediaupscale.Capabilities()
}

func (s *Service) upscaleResource(userID string, request mediaupscale.Request, spec mediaupscale.Model) (*model.Resource, error) {
	resource, err := s.Resource(userID, strings.TrimSpace(request.ResourceID))
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("输入素材不存在或尚未就绪")
	}
	kind := strings.ToLower(strings.TrimSpace(resource.Kind))
	if kind == "" {
		if strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
			kind = "video"
		} else if strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
			kind = "image"
		}
	}
	switch spec.MediaType {
	case "video":
		if kind != "video" || !strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
			return nil, BadAuthRequest("当前超分模型只能处理视频素材")
		}
		switch strings.ToLower(strings.TrimSpace(resource.MimeType)) {
		case "video/mp4", "video/quicktime":
		default:
			return nil, BadAuthRequest("视频超分目前仅支持 MP4 或 MOV 素材")
		}
	case "image":
		if kind != "image" || !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
			return nil, BadAuthRequest("当前超分模型只能处理图片素材")
		}
		switch strings.ToLower(strings.TrimSpace(resource.MimeType)) {
		case "image/png", "image/jpeg", "image/webp":
		default:
			return nil, BadAuthRequest("VOSR2 图片超分仅支持 PNG、JPEG 或 WebP")
		}
	}
	return resource, nil
}

func quoteUpscale(spec mediaupscale.Model, request mediaupscale.Request, resource *model.Resource) (mediaupscale.Quote, error) {
	if spec.ID == mediaupscale.TopazVideoModel {
		return mediaupscale.QuoteTopaz(resource.DurationMs, request.Resolution, request.Quality)
	}
	return mediaupscale.QuoteModel(spec, resource.DurationMs, resource.Width, resource.Height)
}

func (s *Service) EstimateMediaUpscale(ctx context.Context, userID string, request MediaUpscaleRequest) (map[string]any, error) {
	normalized, spec, err := mediaupscale.NormalizeRequest(request)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	resource, err := s.upscaleResource(userID, normalized, spec)
	if err != nil {
		return nil, err
	}
	quote, err := quoteUpscale(spec, normalized, resource)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return map[string]any{
		"mediaType":  spec.MediaType,
		"model":      spec.ID,
		"modelLabel": spec.Label,
		"source": map[string]any{
			"width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs,
		},
		"target": map[string]any{
			"resolution": normalized.Resolution, "quality": normalized.Quality, "outputResolution": spec.OutputResolution,
		},
		"unitPriceCnyPerSecond": quote.UnitPriceCNYPerSecond,
		"fixedPriceCny":         quote.FixedPriceCNY,
		"durationSeconds":       quote.DurationSeconds,
		"reservationCny":        quote.ReservationCNY,
		"currency":              "CNY",
		"billing":               spec.Billing,
		"generationSubmitted":   false,
		"cloudProcessing":       true,
	}, nil
}

func (s *Service) CreateMediaUpscale(ctx context.Context, userID string, request MediaUpscaleRequest) (*model.Task, error) {
	if strings.TrimSpace(request.ClientOperationID) == "" {
		return nil, BadAuthRequest("缺少本次确认的操作 ID")
	}
	normalized, spec, err := mediaupscale.NormalizeRequest(request)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	resource, err := s.upscaleResource(userID, normalized, spec)
	if err != nil {
		return nil, err
	}
	if _, err := quoteUpscale(spec, normalized, resource); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	apiKey, baseURL, _, _, err := s.lookupBeefAPICredential()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(baseURL) == "" {
		return nil, BadAuthRequest("请先连接官方算力账号")
	}
	interfaceType := "newapi-channel-2"
	taskType := "canvas_video"
	media := generation.Media{
		ID: resource.ID, Name: resource.ID, Type: spec.MediaType,
		StorageKey: "resource:" + resource.ID, MimeType: resource.MimeType,
		Bytes: resource.Size, Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs,
	}
	input := map[string]any{
		"mode":   spec.MediaType,
		"prompt": "媒体超分",
		"config": generation.Config{
			BaseURL: baseURL, APIFormat: "openai", InterfaceType: interfaceType,
			APIKey: apiKey, Model: spec.ID, VQuality: normalized.Resolution, Quality: normalized.Quality,
		},
		"metadata": map[string]any{
			"source":            "canvas",
			"operation":         "media.upscale." + spec.ID,
			"mediaUpscaleModel": spec.ID,
			"clientOperationId": normalized.ClientOperationID,
			"nodeId":            normalized.NodeID,
			"upscaleResolution": normalized.Resolution,
			"upscaleQuality":    normalized.Quality,
			"sourceResourceId":  resource.ID,
		},
	}
	if spec.MediaType == "image" {
		interfaceType = "newapi-image"
		taskType = "canvas_image"
		input["config"] = generation.Config{
			BaseURL: baseURL, APIFormat: "openai", InterfaceType: interfaceType,
			APIKey: apiKey, Model: spec.ID,
		}
		input["referenceImages"] = []generation.Media{media}
	} else {
		input["referenceVideos"] = []generation.Media{media}
	}
	return s.CreateTask(userID, CreateTaskRequest{
		ProjectID: normalized.ProjectID,
		Type:      taskType,
		Operation: "media.upscale." + spec.ID,
		Prompt:    "媒体超分",
		Provider:  "beefapi",
		Model:     spec.ID,
		Input:     input,
	})
}
