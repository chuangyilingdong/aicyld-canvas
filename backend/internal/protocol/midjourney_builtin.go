package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

func midjourneyAdapter() Adapter {
	info := metadata("midjourney", "Midjourney 异步图像", "Midjourney", CapabilityImage, "POST /v1/midjourney/generations/{action}", "GET /v1/midjourney/tasks/{task_id}", "application/json")
	info.Execution = "declarative"
	info.Parameters = []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "prompt"},
		{Name: "images", Type: "media[]", Mapping: "provider-specific"},
		{Name: "aspectRatio", Type: "string", Mapping: "provider-specific"},
		{Name: "quality", Type: "string", Mapping: "provider-specific"},
	}
	info.RequiresPublicMediaURLs = true
	return builtinAdapter{
		info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			action, options := midjourneyActionOptions(r)
			allowed := map[string]bool{"imagine": true, "upscale": true, "variation": true, "high-variation": true, "low-variation": true, "reroll": true, "zoom": true, "pan": true, "inpaint": true, "modal": true, "remix-strong": true, "remix-subtle": true, "blend": true, "describe": true, "edits": true, "video": true}
			if !allowed[action] {
				return RequestSpec{}, fmt.Errorf("不支持的 Midjourney 动作：%s", action)
			}
			path := "/v1/midjourney/generations/" + url.PathEscape(action)
			body := map[string]any{"model": "midjourney"}
			prompt := strings.TrimSpace(r.Prompt)
			if prompt != "" && (action == "imagine" || action == "edits" || action == "video" || action == "modal" || action == "remix-strong" || action == "remix-subtle") {
				body["prompt"] = prompt
			}
			if ratio := strings.TrimSpace(r.AspectRatio); ratio != "" && (action == "imagine" || action == "edits" || action == "blend") {
				body["size"] = ratio
			}
			if speed := strings.ToLower(strings.TrimSpace(r.Quality)); action != "video" && (speed == "relax" || speed == "fast" || speed == "turbo") {
				body["speed"] = speed
			}
			images := make([]string, 0, len(r.Images))
			maskURL := ""
			for _, image := range r.Images {
				if image.Role == "mask" {
					maskURL = mediaValue(image)
					continue
				}
				images = append(images, mediaValue(image))
			}
			if len(images) > 0 && (action == "imagine" || action == "blend" || action == "describe" || action == "edits" || action == "video") {
				body["image_urls"] = images
			}
			copyMidjourneyOption(body, options, "taskId", "task_id")
			copyMidjourneyOption(body, options, "customId", "custom_id")
			copyMidjourneyOption(body, options, "direction", "direction")
			copyMidjourneyOption(body, options, "dimensions", "dimensions")
			copyMidjourneyOption(body, options, "videoType", "video_type")
			copyMidjourneyOption(body, options, "animateMode", "animate_mode")
			copyMidjourneyOption(body, options, "motion", "motion")
			copyMidjourneyOption(body, options, "endUrl", "end_url")
			copyMidjourneyOption(body, options, "version", "version")
			if action == "imagine" || action == "edits" {
				copyMidjourneyOption(body, options, "quality", "quality")
				copyMidjourneyOption(body, options, "style", "style")
				copyMidjourneyOption(body, options, "negativePrompt", "negative_prompt")
				copyMidjourneyOption(body, options, "cref", "cref")
				copyMidjourneyOption(body, options, "sref", "sref")
				copyMidjourneyOption(body, options, "dref", "dref")
				copyMidjourneyOption(body, options, "extra", "extra")
				for _, option := range []struct{ key, wire string }{
					{"seed", "seed"}, {"stylize", "stylize"}, {"chaos", "chaos"}, {"weird", "weird"},
					{"cw", "cw"}, {"sw", "sw"}, {"iw", "iw"}, {"dw", "dw"}, {"stop", "stop"},
				} {
					copyMidjourneyNumberOption(body, options, option.key, option.wire)
				}
				for _, option := range []struct{ key, wire string }{
					{"tile", "tile"}, {"niji", "niji"}, {"raw", "raw"}, {"draft", "draft"}, {"hd", "hd"},
				} {
					copyMidjourneyBoolOption(body, options, option.key, option.wire)
				}
			}
			if value := midjourneyInt(options, "index"); value > 0 {
				body["index"] = value
			} else if action == "video" {
				if _, present := options["index"]; present {
					body["index"] = 0
				}
			}
			if value := midjourneyFloat(options, "zoomRatio"); value > 0 {
				body["zoom_ratio"] = value
			}
			if value := midjourneyInt(options, "batchSize"); value == 1 || value == 2 || value == 4 {
				body["batch_size"] = value
			}
			if action == "modal" {
				if maskURL == "" {
					maskURL = midjourneyString(options, "maskUrl")
				}
				if maskURL != "" {
					body["mask_url"] = maskURL
				}
			}
			if err := validateMidjourneyAction(action, body, len(images)); err != nil {
				return RequestSpec{}, err
			}
			return jsonSpec(http.MethodPost, path, body), nil
		},
		parseCreate: parseMidjourneyCreate,
		poll: func(c PollContext) (RequestSpec, error) {
			return RequestSpec{Method: http.MethodGet, Path: "/v1/midjourney/tasks/" + url.PathEscape(c.TaskID)}, nil
		},
		parsePoll: parseMidjourneyPoll,
	}
}

func parseMidjourneyCreate(payload map[string]any) (CreateResult, error) {
	created, err := parseAsyncCreate(payload)
	if err == nil {
		return created, nil
	}
	text := strings.TrimSpace(firstString(payload, "description", "text"))
	if text == "" {
		return CreateResult{}, err
	}
	return CreateResult{
		Status: StatusSucceeded,
		Result: &Result{Text: text, ProviderMetadata: midjourneyProviderMetadata(payload)},
	}, nil
}

func parseMidjourneyPoll(c PollContext, payload map[string]any) (PollResult, error) {
	status := normalizeStatus(firstString(payload, "status", "state", "task_status"))
	if task := object(payload["task"]); task != nil {
		payload = mergeMaps(task, payload)
		status = normalizeStatus(defaultValue(firstString(task, "status", "state", "task_status"), string(status)))
	}
	if data := object(payload["data"]); data != nil {
		payload = mergeMaps(data, payload)
		status = normalizeStatus(defaultValue(firstString(data, "status", "state", "task_status"), string(status)))
	}
	if status == "" {
		status = StatusProcessing
	}
	taskID := defaultValue(firstString(payload, "task_id", "taskId", "id"), c.TaskID)
	message := firstString(payload, "fail_reason", "message", "description")
	if failure := object(payload["error"]); failure != nil {
		message = defaultValue(firstString(failure, "message", "detail", "code"), message)
	}
	if status == StatusFailed || status == StatusCancelled {
		return PollResult{TaskID: taskID, Status: status, Message: defaultValue(message, "Midjourney 生成失败")}, nil
	}
	if status != StatusSucceeded {
		return PollResult{TaskID: taskID, Status: status, Message: message}, nil
	}
	providerMetadata := midjourneyProviderMetadata(payload)
	if action, _ := midjourneyActionOptions(c.Request); action == "describe" {
		text := firstString(payload, "prompt", "description", "text")
		if text == "" {
			return PollResult{}, fmt.Errorf("Midjourney describe 完成响应没有返回提示词")
		}
		return PollResult{TaskID: taskID, Status: status, Result: &Result{Text: text, Usage: object(payload["usage"]), ProviderMetadata: providerMetadata}, Message: message}, nil
	}
	images := make([]MediaReference, 0, 4)
	// The API returns four independent images plus a grid. Persist the four
	// outputs independently so each can be rebound and used by follow-up actions.
	images = append(images, mediaFromArray(payload["image_urls"], CapabilityImage)...)
	if len(images) == 0 {
		images = append(images, mediaFromArray(payload["images"], CapabilityImage)...)
	}
	if len(images) == 0 {
		if grid := firstString(payload, "grid_image_url", "gridImageUrl"); grid != "" {
			images = append(images, MediaReference{URL: grid, Kind: "image"})
		}
	}
	if len(images) == 0 {
		if value := firstString(payload, "image_url", "imageUrl", "url"); value != "" {
			images = append(images, MediaReference{URL: value, Kind: "image"})
		}
	}
	action, _ := midjourneyActionOptions(c.Request)
	if action == "video" {
		videos := mediaFromArray(payload["video_urls"], CapabilityVideo)
		if len(videos) == 0 {
			videos = mediaFromArray(payload["videos"], CapabilityVideo)
		}
		if len(videos) == 0 {
			if value := firstString(payload, "video_url", "videoUrl"); value != "" {
				videos = append(videos, MediaReference{URL: value, Kind: "video"})
			}
		}
		if len(videos) == 0 {
			return PollResult{}, fmt.Errorf("Midjourney video 完成响应没有返回视频")
		}
		return PollResult{TaskID: taskID, Status: status, Result: &Result{Videos: videos, Usage: object(payload["usage"]), ProviderMetadata: providerMetadata}, Message: message}, nil
	}
	if len(images) == 0 {
		return PollResult{}, fmt.Errorf("Midjourney 完成响应没有返回图片")
	}
	return PollResult{TaskID: taskID, Status: status, Result: &Result{Images: images, Usage: object(payload["usage"]), ProviderMetadata: providerMetadata}, Message: message}, nil
}

func midjourneyProviderMetadata(payload map[string]any) map[string]any {
	items, _ := payload["buttons"].([]any)
	if len(items) == 0 {
		return nil
	}
	buttons := make([]map[string]any, 0, len(items))
	for _, item := range items {
		button, _ := item.(map[string]any)
		if button == nil {
			continue
		}
		customID := strings.TrimSpace(firstString(button, "customId", "custom_id"))
		if customID == "" {
			continue
		}
		next := map[string]any{"customId": customID}
		if label := strings.TrimSpace(firstString(button, "label")); label != "" {
			next["label"] = label
		}
		if emoji := strings.TrimSpace(firstString(button, "emoji")); emoji != "" {
			next["emoji"] = emoji
		}
		buttons = append(buttons, next)
	}
	if len(buttons) == 0 {
		return nil
	}
	return map[string]any{"midjourneyButtons": buttons}
}

func midjourneyActionOptions(request GenerationRequest) (string, map[string]any) {
	options := map[string]any{}
	if configured := object(request.Extra["midjourney"]); configured != nil {
		for key, value := range configured {
			options[key] = value
		}
	}
	action := strings.ToLower(strings.TrimSpace(midjourneyString(options, "action")))
	if action == "" {
		model := strings.ToLower(strings.TrimSpace(request.Model))
		if strings.HasPrefix(model, "midjourney-") {
			action = strings.TrimPrefix(model, "midjourney-")
		} else {
			action = "imagine"
		}
	}
	return action, options
}

func copyMidjourneyOption(body map[string]any, options map[string]any, key string, wire string) {
	if value := strings.TrimSpace(midjourneyString(options, key)); value != "" {
		body[wire] = value
	}
}

func copyMidjourneyNumberOption(body map[string]any, options map[string]any, key string, wire string) {
	if _, present := options[key]; !present {
		return
	}
	switch value := options[key].(type) {
	case float64:
		body[wire] = value
	case float32:
		body[wire] = value
	case int:
		body[wire] = value
	case int64:
		body[wire] = value
	case json.Number:
		if number, err := value.Float64(); err == nil {
			body[wire] = number
		}
	}
}

func copyMidjourneyBoolOption(body map[string]any, options map[string]any, key string, wire string) {
	if value, ok := options[key].(bool); ok {
		body[wire] = value
	}
}

func midjourneyString(options map[string]any, key string) string {
	value, _ := options[key].(string)
	return value
}

func midjourneyInt(options map[string]any, key string) int {
	switch value := options[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case json.Number:
		result, _ := value.Int64()
		return int(result)
	default:
		return 0
	}
}

func midjourneyFloat(options map[string]any, key string) float64 {
	switch value := options[key].(type) {
	case float64:
		return value
	case int:
		return float64(value)
	case json.Number:
		result, _ := value.Float64()
		return result
	default:
		return 0
	}
}

func validateMidjourneyAction(action string, body map[string]any, imageCount int) error {
	taskID := strings.TrimSpace(midjourneyString(body, "task_id"))
	customID := strings.TrimSpace(midjourneyString(body, "custom_id"))
	index := midjourneyInt(body, "index")
	switch action {
	case "imagine":
		if strings.TrimSpace(midjourneyString(body, "prompt")) == "" {
			return errors.New("Midjourney imagine 缺少 prompt")
		}
	case "blend":
		if imageCount < 2 || imageCount > 4 {
			return errors.New("Midjourney blend 需要 2–4 张图片")
		}
	case "describe", "edits":
		if imageCount == 0 {
			return errors.New("Midjourney " + action + " 缺少图片")
		}
		if action == "edits" && strings.TrimSpace(midjourneyString(body, "prompt")) == "" {
			return errors.New("Midjourney edits 缺少 prompt")
		}
	case "upscale", "variation", "high-variation", "low-variation", "inpaint", "remix-strong", "remix-subtle":
		if taskID == "" {
			return errors.New("Midjourney " + action + " 缺少父任务 task_id")
		}
		if customID == "" && index < 1 {
			return errors.New("Midjourney " + action + " 需要 index 1–4")
		}
		if index > 4 {
			return errors.New("Midjourney " + action + " 的 index 必须在 1–4")
		}
	case "reroll", "zoom":
		if taskID == "" {
			return errors.New("Midjourney " + action + " 缺少父任务 task_id")
		}
	case "pan":
		if taskID == "" {
			return errors.New("Midjourney pan 缺少父任务 task_id")
		}
		if customID == "" {
			direction := strings.ToLower(strings.TrimSpace(midjourneyString(body, "direction")))
			if direction != "left" && direction != "right" && direction != "up" && direction != "down" {
				return errors.New("Midjourney pan 缺少有效 direction")
			}
		}
	case "modal":
		if taskID == "" {
			return errors.New("Midjourney modal 缺少 inpaint task_id")
		}
		if strings.TrimSpace(midjourneyString(body, "mask_url")) == "" {
			return errors.New("Midjourney modal 缺少 mask_url")
		}
	case "video":
		if taskID == "" && imageCount == 0 {
			return errors.New("Midjourney video 需要图片或父任务 task_id")
		}
		if mode := strings.TrimSpace(midjourneyString(body, "animate_mode")); mode == "auto" {
			if taskID == "" {
				return errors.New("Midjourney video animate_mode=auto 需要 task_id")
			}
			if _, present := body["index"]; !present {
				return errors.New("Midjourney video animate_mode=auto 需要 index 0–3")
			}
			if index < 0 || index > 3 {
				return errors.New("Midjourney video 的 index 必须在 0–3")
			}
		}
	}
	return nil
}
