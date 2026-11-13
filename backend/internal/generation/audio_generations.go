package generation

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const (
	audioGenerationsPollInterval = 2 * time.Second
	audioGenerationsPollTimeout  = 30 * time.Minute
)

// runAudioGenerationsTask adapts New API audio generation endpoints:
// POST /v1/audio/generations and GET /v1/audio/generations/{task_id}.
func runAudioGenerationsTask(ctx context.Context, input Input) (map[string]interface{}, error) {
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, RequestPreparationError{Cause: errors.New("音频提示词不能为空")}
	}
	body := map[string]interface{}{
		"model":  input.Config.Model,
		"prompt": input.Prompt,
	}
	if voice := strings.TrimSpace(input.Config.AudioVoice); voice != "" {
		body["voice"] = voice
	}
	if format := strings.TrimSpace(input.Config.AudioFormat); format != "" {
		body["response_format"] = format
	}
	if speed := strings.TrimSpace(input.Config.AudioSpeed); speed != "" {
		if value, err := strconv.ParseFloat(speed, 64); err == nil {
			body["speed"] = value
		}
	}
	for _, field := range []struct{ input, output string }{
		{"audioLyrics", "lyrics"},
		{"audioIsInstrumental", "is_instrumental"},
		{"audioLyricsOptimizer", "lyrics_optimizer"},
	} {
		if value, exists := input.Metadata[field.input]; exists {
			body[field.output] = value
		}
	}

	var submitted map[string]interface{}
	if err := PostJSONWithSubmissionKey(ctx, input.Config, "/audio/generations", body, &submitted); err != nil {
		return nil, err
	}
	taskID := audioGenerationTaskID(submitted)
	if taskID == "" {
		return nil, ResponseDecodeError{Err: errors.New("音频生成接口没有返回任务 ID")}
	}

	pollContext, cancel := context.WithTimeout(ctx, audioGenerationsPollTimeout)
	defer cancel()
	for {
		var polled map[string]interface{}
		if err := GetJSON(pollContext, input.Config, "/audio/generations/"+taskID, &polled); err != nil {
			return nil, err
		}
		state := audioGenerationState(polled)
		status := strings.ToUpper(strings.TrimSpace(stringValue(state["status"])))
		switch status {
		case "SUCCESS", "SUCCEEDED", "COMPLETED", "DONE":
			resultURL := audioGenerationResultURL(state)
			if resultURL == "" {
				return nil, ResponseDecodeError{Err: errors.New("音频任务成功但没有返回结果地址")}
			}
			data, mimeType, err := GetProviderExternalBinary(pollContext, input.Config, resultURL)
			if err != nil {
				return nil, err
			}
			mimeType, err = ValidateGeneratedAudio(mimeType, data, input.Config.AudioFormat)
			if err != nil {
				return nil, err
			}
			format := strings.TrimPrefix(strings.ToLower(mimeType), "audio/")
			if format == "mpeg" || format == "mp3" {
				format = "mp3"
			}
			return map[string]interface{}{
				"mode": "audio",
				"audio": map[string]interface{}{
					"dataUrl": DataURL(mimeType, data), "mimeType": mimeType, "format": format,
				},
			}, nil
		case "FAILED", "ERROR", "CANCELLED", "CANCELED":
			message := stringValue(state["fail_reason"])
			if message == "" {
				message = stringValue(state["message"])
			}
			if message == "" {
				message = "音频生成失败"
			}
			return nil, NewPayloadError(message, message)
		}
		select {
		case <-pollContext.Done():
			if errors.Is(pollContext.Err(), context.DeadlineExceeded) {
				return nil, fmt.Errorf("音频生成超时（任务 %s）", taskID)
			}
			return nil, pollContext.Err()
		case <-time.After(audioGenerationsPollInterval):
		}
	}
}

func audioGenerationTaskID(payload map[string]interface{}) string {
	state := audioGenerationState(payload)
	for _, key := range []string{"task_id", "id"} {
		if value := strings.TrimSpace(stringValue(state[key])); value != "" {
			return value
		}
	}
	return ""
}

func audioGenerationState(payload map[string]interface{}) map[string]interface{} {
	if data, ok := payload["data"].(map[string]interface{}); ok {
		if nested, ok := data["data"].(map[string]interface{}); ok {
			merged := make(map[string]interface{}, len(data)+len(nested))
			for key, value := range data {
				merged[key] = value
			}
			for key, value := range nested {
				merged[key] = value
			}
			return merged
		}
		return data
	}
	return payload
}

func audioGenerationResultURL(payload map[string]interface{}) string {
	for _, key := range []string{"result_url", "audio_url", "output_url", "url"} {
		if value := strings.TrimSpace(stringValue(payload[key])); strings.HasPrefix(value, "http") || strings.HasPrefix(value, "data:audio/") {
			return value
		}
	}
	for _, key := range []string{"content", "data", "result", "output", "upstream"} {
		if nested, ok := payload[key].(map[string]interface{}); ok {
			if value := audioGenerationResultURL(nested); value != "" {
				return value
			}
		}
	}
	return ""
}

func stringValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func usesAudioGenerationsEndpoint(model string) bool {
	id := strings.ToLower(strings.TrimSpace(model))
	if index := strings.LastIndex(id, "::"); index >= 0 {
		id = id[index+2:]
	}
	return strings.Contains(id, "doubao-seed-audio") || strings.Contains(id, "mureka") || strings.Contains(id, "minimax-music")
}
