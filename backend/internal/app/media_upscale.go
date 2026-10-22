package app

import (
	"context"
	"strings"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/mediaupscale"
	"infinite-canvas/backend/internal/model"
)

type MediaUpscaleRequest = mediaupscale.VideoRequest

func (s *Service) MediaUpscaleCapabilities() map[string]any {
	return mediaupscale.VideoCapabilities()
}

func (s *Service) upscaleVideoResource(userID, resourceID string) (*model.Resource, error) {
	resource, err := s.Resource(userID, strings.TrimSpace(resourceID))
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("输入视频不存在或尚未就绪")
	}
	if !strings.EqualFold(resource.Kind, "video") && !strings.HasPrefix(strings.ToLower(resource.MimeType), "video/") {
		return nil, BadAuthRequest("Topaz 视频超分只能处理视频素材")
	}
	switch strings.ToLower(strings.TrimSpace(resource.MimeType)) {
	case "video/mp4", "video/quicktime":
	default:
		return nil, BadAuthRequest("Topaz 视频超分目前仅支持 MP4 或 MOV 素材")
	}
	return resource, nil
}

func (s *Service) EstimateMediaUpscale(ctx context.Context, userID string, request MediaUpscaleRequest) (map[string]any, error) {
	if err := mediaupscale.ValidateVideo(request); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	resource, err := s.upscaleVideoResource(userID, request.ResourceID)
	if err != nil {
		return nil, err
	}
	quote, err := mediaupscale.QuoteVideo(resource.DurationMs, request.Resolution, request.Quality)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	return map[string]any{
		"mediaType": "video",
		"model":     mediaupscale.TopazVideoModel,
		"source": map[string]any{
			"width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs,
		},
		"target": map[string]any{
			"resolution": request.Resolution, "quality": request.Quality,
		},
		"unitPriceCnyPerSecond": quote.UnitPriceCNYPerSecond,
		"durationSeconds":       quote.DurationSeconds,
		"reservationCny":        quote.ReservationCNY,
		"currency":              "CNY",
		"billing":               "actual_output_duration",
		"generationSubmitted":   false,
		"cloudProcessing":       true,
	}, nil
}

func (s *Service) CreateMediaUpscale(ctx context.Context, userID string, request MediaUpscaleRequest) (*model.Task, error) {
	if strings.TrimSpace(request.ClientOperationID) == "" {
		return nil, BadAuthRequest("缺少本次确认的操作 ID")
	}
	if err := mediaupscale.ValidateVideo(request); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	resource, err := s.upscaleVideoResource(userID, request.ResourceID)
	if err != nil {
		return nil, err
	}
	if _, err := mediaupscale.QuoteVideo(resource.DurationMs, request.Resolution, request.Quality); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	apiKey, baseURL, _, _, err := s.lookupBeefAPICredential()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" || strings.TrimSpace(baseURL) == "" {
		return nil, BadAuthRequest("请先连接官方算力账号")
	}
	input := map[string]any{
		"mode":   "video",
		"prompt": "Topaz 视频超分",
		"config": generation.Config{
			BaseURL:       baseURL,
			APIFormat:     "openai",
			InterfaceType: "newapi-channel-2",
			APIKey:        apiKey,
			Model:         mediaupscale.TopazVideoModel,
			VQuality:      request.Resolution,
			Quality:       request.Quality,
		},
		"referenceVideos": []generation.Media{{
			ID:         resource.ID,
			Name:       resource.ID,
			Type:       "video",
			StorageKey: "resource:" + resource.ID,
			MimeType:   resource.MimeType,
			Bytes:      resource.Size,
			Width:      resource.Width,
			Height:     resource.Height,
			DurationMs: resource.DurationMs,
		}},
		"metadata": map[string]any{
			"source":            "canvas",
			"operation":         "media.upscale.topaz",
			"clientOperationId": request.ClientOperationID,
			"nodeId":            request.NodeID,
			"upscaleResolution": request.Resolution,
			"upscaleQuality":    request.Quality,
			"sourceResourceId":  resource.ID,
		},
	}
	return s.CreateTask(userID, CreateTaskRequest{
		ProjectID: request.ProjectID,
		Type:      "canvas_video",
		Operation: "media.upscale.topaz",
		Prompt:    "Topaz 视频超分",
		Provider:  "beefapi",
		Model:     mediaupscale.TopazVideoModel,
		Input:     input,
	})
}
