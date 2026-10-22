package generation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/mediaupscale"
)

func IsTopazVideoUpscaleModel(modelName string) bool {
	return strings.TrimSpace(modelName) == mediaupscale.TopazVideoModel
}

func TopazVideoUpscaleBody(input Input) (map[string]any, error) {
	if !IsTopazVideoUpscaleModel(input.Config.Model) {
		return nil, errors.New("当前任务不是 Topaz 视频超分")
	}
	if len(input.ReferenceVideos) != 1 || len(input.ReferenceImages) != 0 || len(input.ReferenceAudios) != 0 || input.Mask != nil {
		return nil, errors.New("Topaz 视频超分仅接受一个源视频")
	}
	videoURL := strings.TrimSpace(input.ReferenceVideos[0].URL)
	if !IsPublicMediaURL(videoURL) {
		return nil, errors.New("Topaz 视频超分需要上游可访问的视频地址")
	}
	resolution := metadataString(input.Metadata, "upscaleResolution")
	if resolution == "" {
		resolution = input.Config.VQuality
	}
	quality := metadataString(input.Metadata, "upscaleQuality")
	if quality == "" {
		quality = input.Config.Quality
	}
	if err := mediaupscale.ValidateVideo(mediaupscale.VideoRequest{
		ResourceID: input.ReferenceVideos[0].ID,
		Resolution: resolution,
		Quality:    quality,
	}); err != nil {
		return nil, err
	}
	return map[string]any{
		"model": mediaupscale.TopazVideoModel,
		"metadata": map[string]any{
			"video_url":  []string{videoURL},
			"resolution": resolution,
			"quality":    quality,
		},
	}, nil
}

func RunTopazVideoUpscaleTask(ctx context.Context, input Input, pollPolicy VideoPollPolicy) (map[string]any, error) {
	pollPolicy = videoPollPolicyForConfig(ctx, input.Config, pollPolicy)
	id := ResumedProviderRequestID(ctx)
	var created map[string]any
	if id == "" {
		body, err := TopazVideoUpscaleBody(input)
		if err != nil {
			return nil, err
		}
		if err := PostJSONWithSubmissionKey(ctx, input.Config, "/v1/video/generations", body, &created); err != nil {
			return nil, err
		}
		if data, ok := created["data"].(map[string]any); ok {
			created = data
		}
		extracted, err := firstJSONString(created, "id", "task_id")
		if err != nil {
			return nil, SubmissionUnknownError{Cause: fmt.Errorf("Topaz 超分接口任务 ID 无效：%w", err)}
		}
		id = extracted
	}
	if id == "" {
		return nil, SubmissionUnknownError{Cause: errors.New("Topaz 超分接口没有返回任务 ID")}
	}
	return RunVideoPollLoop(ctx, id, pollPolicy, func(ctx context.Context) (VideoPollOutcome, error) {
		var state map[string]any
		if err := GetJSON(ctx, input.Config, "/v1/video/generations/"+id, &state); err != nil {
			return VideoPollOutcome{}, err
		}
		var stateErr error
		state, stateErr = ValidateVideoTaskState(id, state)
		if stateErr != nil {
			return VideoPollOutcome{}, stateErr
		}
		status, videoURL := topazVideoPollStatusAndURL(state)
		if VideoTaskSucceeded(status) {
			if videoURL == "" {
				return VideoPollOutcome{}, errors.New("Topaz 超分已完成，但结果中没有视频地址")
			}
			data, mimeType, err := RunVideoDownload(ctx, id, pollPolicy, videoResultDownloader(input.Config, videoURL, id))
			if err != nil {
				return VideoPollOutcome{}, fmt.Errorf("Topaz 超分结果下载失败：%w", err)
			}
			mimeType = NormalizedMediaMIMEType(mimeType, data)
			return VideoPollOutcome{Done: true, Result: map[string]any{
				"mode":  "video",
				"video": map[string]any{"dataUrl": DataURL(mimeType, data), "mimeType": mimeType},
			}}, nil
		}
		if status == "failed" || status == "cancelled" || status == "expired" {
			message := SeedanceErrorMessage(state)
			if message == "" {
				payload, _ := json.Marshal(map[string]any{"error": map[string]string{
					"code": "topaz_upscale_failed", "message": "Topaz 视频超分失败", "task_id": id,
				}})
				message = string(payload)
			}
			return VideoPollOutcome{}, errors.New(message)
		}
		return VideoPollOutcome{}, nil
	})
}

func topazVideoPollStatusAndURL(state map[string]any) (string, string) {
	status := strings.ToLower(stringField(state, "status"))
	if metadata, ok := state["metadata"].(map[string]any); ok {
		if nested := strings.ToLower(stringField(metadata, "generation_status")); nested != "" {
			status = nested
		}
	}
	for _, key := range []string{"content", "output", "result", "video", "data"} {
		if nested, ok := state[key].(map[string]any); ok {
			if value := topazResultURL(nested); value != "" {
				return status, value
			}
		}
	}
	return status, topazResultURL(state)
}

func topazResultURL(payload map[string]any) string {
	for _, key := range []string{"video_url", "videoUrl", "url", "result_url", "resultUrl"} {
		if value := strings.TrimSpace(stringField(payload, key)); IsPublicMediaURL(value) {
			return value
		}
	}
	return ""
}
