package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/mediaupscale"
)

func UpscaleMediaType(modelName string) string {
	model, ok := mediaupscale.FindModel(modelName)
	if !ok {
		return ""
	}
	return model.MediaType
}

func IsMediaUpscaleModel(modelName string) bool {
	return UpscaleMediaType(modelName) != ""
}

func MediaUpscaleBody(input Input) (map[string]any, error) {
	model, ok := mediaupscale.FindModel(input.Config.Model)
	if !ok || model.ID != strings.TrimSpace(input.Config.Model) {
		return nil, errors.New("当前任务不是受支持的媒体超分模型")
	}
	switch model.MediaType {
	case "image":
		if len(input.ReferenceImages) != 1 || len(input.ReferenceVideos) != 0 || len(input.ReferenceAudios) != 0 || input.Mask != nil {
			return nil, errors.New("图片超分仅接受一个源图片")
		}
		imageURL := strings.TrimSpace(input.ReferenceImages[0].URL)
		if !IsPublicMediaURL(imageURL) {
			return nil, errors.New("图片超分需要上游可访问的图片地址")
		}
		return map[string]any{"model": model.ID, "images": []string{imageURL}}, nil
	case "video":
		if len(input.ReferenceVideos) != 1 || len(input.ReferenceImages) != 0 || len(input.ReferenceAudios) != 0 || input.Mask != nil {
			return nil, errors.New("视频超分仅接受一个源视频")
		}
		videoURL := strings.TrimSpace(input.ReferenceVideos[0].URL)
		if !IsPublicMediaURL(videoURL) {
			return nil, errors.New("视频超分需要上游可访问的视频地址")
		}
		metadata := map[string]any{"video_url": []string{videoURL}}
		if model.ID == mediaupscale.TopazVideoModel {
			resolution := metadataString(input.Metadata, "upscaleResolution")
			if resolution == "" {
				resolution = input.Config.VQuality
			}
			quality := metadataString(input.Metadata, "upscaleQuality")
			if quality == "" {
				quality = input.Config.Quality
			}
			if _, _, err := mediaupscale.NormalizeRequest(mediaupscale.Request{
				Model: model.ID, ResourceID: input.ReferenceVideos[0].ID, Resolution: resolution, Quality: quality,
			}); err != nil {
				return nil, err
			}
			metadata["resolution"] = resolution
			metadata["quality"] = quality
		}
		return map[string]any{"model": model.ID, "metadata": metadata}, nil
	default:
		return nil, errors.New("媒体超分模型类型无效")
	}
}

func RunMediaUpscaleTask(ctx context.Context, input Input, pollPolicy VideoPollPolicy) (map[string]any, error) {
	model, ok := mediaupscale.FindModel(input.Config.Model)
	if !ok || model.ID != strings.TrimSpace(input.Config.Model) {
		return nil, errors.New("当前任务不是受支持的媒体超分模型")
	}
	pollPolicy = videoPollPolicyForConfig(ctx, input.Config, pollPolicy)
	id := ResumedProviderRequestID(ctx)
	if id == "" {
		body, err := MediaUpscaleBody(input)
		if err != nil {
			return nil, err
		}
		submitPath := "/v1/video/generations"
		if model.MediaType == "image" {
			submitPath = "/v1/image/generations"
		}
		var created map[string]any
		if err := PostJSONWithSubmissionKey(ctx, input.Config, submitPath, body, &created); err != nil {
			return nil, err
		}
		if data, ok := created["data"].(map[string]any); ok {
			created = data
		}
		extracted, err := firstJSONString(created, "id", "task_id")
		if err != nil {
			return nil, SubmissionUnknownError{Cause: fmt.Errorf("媒体超分接口任务 ID 无效：%w", err)}
		}
		id = extracted
	}
	if id == "" {
		return nil, SubmissionUnknownError{Cause: errors.New("媒体超分接口没有返回任务 ID")}
	}
	pollPath := "/v1/video/generations/" + id
	if model.MediaType == "image" {
		pollPath = "/v1/image/generations/" + id
	}
	return RunVideoPollLoop(ctx, id, pollPolicy, func(ctx context.Context) (VideoPollOutcome, error) {
		var state map[string]any
		if err := GetJSON(ctx, input.Config, pollPath, &state); err != nil {
			return VideoPollOutcome{}, err
		}
		var stateErr error
		state, stateErr = ValidateVideoTaskState(id, state)
		if stateErr != nil {
			return VideoPollOutcome{}, stateErr
		}
		status, resultURL := mediaUpscalePollStatusAndURL(state)
		if VideoTaskSucceeded(status) {
			if resultURL == "" {
				return VideoPollOutcome{}, errors.New("媒体超分已完成，但结果中没有可下载地址")
			}
			download := videoResultDownloader(input.Config, resultURL, id)
			if model.MediaType == "image" {
				download = func(ctx context.Context) ([]byte, string, error) {
					return GetProviderExternalBinary(ctx, input.Config, resultURL)
				}
			}
			data, mimeType, err := RunVideoDownload(ctx, id, pollPolicy, download)
			if err != nil {
				return VideoPollOutcome{}, fmt.Errorf("媒体超分结果下载失败：%w", err)
			}
			mimeType = NormalizedMediaMIMEType(mimeType, data)
			if model.MediaType == "image" {
				if err := ValidateImageArtifact(data, mimeType); err != nil {
					return VideoPollOutcome{}, fmt.Errorf("超分结果不是有效图片：%w", err)
				}
				return VideoPollOutcome{Done: true, Result: map[string]any{
					"mode": "image", "images": []map[string]any{{"dataUrl": DataURL(mimeType, data), "mimeType": mimeType}},
				}}, nil
			}
			if !strings.HasPrefix(mimeType, "video/") {
				return VideoPollOutcome{}, errors.New("超分结果不是有效视频")
			}
			return VideoPollOutcome{Done: true, Result: map[string]any{
				"mode": "video", "video": map[string]any{"dataUrl": DataURL(mimeType, data), "mimeType": mimeType},
			}}, nil
		}
		if status == "failed" || status == "cancelled" || status == "expired" {
			message := SeedanceErrorMessage(state)
			if message == "" {
				payload, _ := json.Marshal(map[string]any{"error": map[string]string{
					"code": "media_upscale_failed", "message": "媒体超分失败", "task_id": id,
				}})
				message = string(payload)
			}
			return VideoPollOutcome{}, errors.New(message)
		}
		return VideoPollOutcome{}, nil
	})
}

func mediaUpscalePollStatusAndURL(state map[string]any) (string, string) {
	status := strings.ToLower(stringField(state, "status"))
	if metadata, ok := state["metadata"].(map[string]any); ok {
		if nested := strings.ToLower(stringField(metadata, "generation_status")); nested != "" {
			status = nested
		}
	}
	for _, key := range []string{"content", "output", "result", "video", "data"} {
		if nested, ok := state[key].(map[string]any); ok {
			if value := mediaUpscaleResultURL(nested); value != "" {
				return status, value
			}
		}
	}
	return status, mediaUpscaleResultURL(state)
}

func mediaUpscaleResultURL(payload map[string]any) string {
	for _, key := range []string{"video_url", "videoUrl", "image_url", "imageUrl", "url", "result_url", "resultUrl"} {
		if value := strings.TrimSpace(stringField(payload, key)); IsPublicMediaURL(value) {
			return value
		}
	}
	return ""
}
