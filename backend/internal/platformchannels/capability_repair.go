package platformchannels

import (
	"encoding/json"
	"strings"
)

// repairKnownCapability keeps persisted platform profiles aligned with the
// media fields that the installed protocol actually sends. Older generated
// channel files described the first frame as a one-image operation, although
// the same upstream endpoint accepts a second image as the last frame.
func repairKnownProfile(profile ModelProfile) ModelProfile {
	if strings.TrimSpace(profile.Family) == "" {
		profile.Family = knownModelFamily(profile.Model)
	}
	return repairKnownCapability(profile)
}

func knownModelFamily(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.HasPrefix(name, "rh-gpt-image-2.6-sunburst-"):
		return "Lib Image 2.6 Pro · Sunburst"
	case strings.HasPrefix(name, "rh-gpt-image-2.6-flare-"):
		return "Lib Image 2.6 Pro · Flare"
	case strings.HasPrefix(name, "rh-gpt-image-2.5-sunburst-"):
		return "Lib Image 2.5 Pro · Sunburst"
	case strings.HasPrefix(name, "rh-gpt-image-2.5-flare-"):
		return "Lib Image 2.5 Pro · Flare"
	case strings.HasPrefix(name, "rh-seedream-v5-pro-"):
		return "Seedream 5 Pro"
	case strings.HasPrefix(name, "rh-seedream-v5.5-layer"):
		return "Seedream 5.5 图层拆分"
	case strings.HasPrefix(name, "rh-seedream-v5.5-"):
		return "Seedream 5.5"
	case strings.HasPrefix(name, "rh-midjourney-v8.1-"):
		return "悠船 V8.1"
	case strings.HasPrefix(name, "rh-midjourney-v8.2-"):
		return "悠船 V8.2"
	case strings.HasPrefix(name, "rh-minimax-h3-image-"):
		return "MiniMax H3 Image"
	case strings.HasPrefix(name, "rh-nano-banana-2.1-"):
		return "Nano Banana 2.1"
	default:
		return ""
	}
}

func repairKnownCapability(profile ModelProfile) ModelProfile {
	if len(profile.CapabilityConfig) == 0 {
		return profile
	}
	var root map[string]any
	if json.Unmarshal(profile.CapabilityConfig, &root) != nil {
		return profile
	}
	endpoint := strings.ToLower(strings.TrimSpace(profile.ProviderModelKey))
	changed := false
	if strings.Contains(endpoint, "kling-lip-sync/lip-sync-video") && !profile.Hidden {
		profile.Hidden = true
		changed = true
	}
	if endpoint == "kling-lip-sync/tts" && !profile.Hidden {
		// The documented default voice and numeric speed still receive a
		// provider-side 1000 error, so do not advertise an unusable endpoint.
		profile.Hidden = true
		changed = true
	}

	switch profile.Capability {
	case "image":
		image := objectValue(root["image"])
		references := objectValue(image["references"])
		if formats, defaultFormat, ok := imageOutputFormats(endpoint); ok {
			image["outputFormat"] = map[string]any{
				"supported": true,
				"values":    formats,
				"default":   defaultFormat,
			}
			changed = true
		}
		if endpoint == "seedream-v5.5/layer-decomposition" {
			if integerValue(references["maxImages"]) < 1 {
				references["maxImages"] = 1
				changed = true
			}
			image["references"] = references
			image["size"] = map[string]any{
				"parameter": "none", "values": []string{}, "default": "auto", "allowCustom": false,
			}
			image["quality"] = map[string]any{
				"supported": true, "values": []string{"auto", "1k", "1.5k", "2k"}, "default": "auto",
			}
			root["image"] = image
			changed = true
		}
	case "video":
		video := objectValue(root["video"])
		references := objectValue(video["references"])
		operations := stringValues(video["operations"])

		if endpoint == "bytedance/seedance-2.5-flash-token/image-to-video" {
			ratios := stringValues(video["ratios"])
			if len(ratios) != 1 || ratios[0] != "adaptive" {
				video["ratios"] = []string{"adaptive"}
				video["defaultRatio"] = "adaptive"
				changed = true
			}
		}

		if containsString(operations, "first_last_frame") {
			if integerValue(references["minImages"]) < 1 {
				references["minImages"] = 1
				changed = true
			}
			if integerValue(references["maxImages"]) < 2 {
				references["maxImages"] = 2
				changed = true
			}
		}
		if strings.Contains(endpoint, "motion-control") {
			if integerValue(references["minImages"]) < 1 {
				references["minImages"] = 1
				changed = true
			}
			if integerValue(references["maxImages"]) < 1 {
				references["maxImages"] = 1
				changed = true
			}
		}
		if strings.Contains(endpoint, "image-audio-to-video") {
			if integerValue(references["minImages"]) < 1 {
				references["minImages"] = 1
				changed = true
			}
			if integerValue(references["maxImages"]) < 1 {
				references["maxImages"] = 1
				changed = true
			}
			if integerValue(references["maxAudios"]) < 1 {
				references["maxAudios"] = 1
				changed = true
			}
			if len(operations) != 1 || operations[0] != "audio_to_video" {
				video["operations"] = []string{"audio_to_video"}
				video["defaultOperation"] = "audio_to_video"
				changed = true
			}
		}

		if changed {
			video["references"] = references
			root["video"] = video
		}
	default:
		return profile
	}

	if !changed {
		return profile
	}
	encoded, err := json.Marshal(root)
	if err != nil {
		return profile
	}
	profile.CapabilityConfig = encoded
	return profile
}

func imageOutputFormats(endpoint string) ([]string, string, bool) {
	switch {
	case strings.Contains(endpoint, "rhart-image-g-2.6-") && strings.Contains(endpoint, "/edit"):
		return []string{"jpeg", "png", "webp", "gif"}, "png", true
	case strings.Contains(endpoint, "rhart-image-g-2.6-"):
		return []string{"jpeg", "png", "webp", "gif", "svg"}, "png", true
	case strings.Contains(endpoint, "rhart-image-g-2.5-"):
		return []string{"jpeg", "png", "webp"}, "png", true
	case strings.Contains(endpoint, "seedream-v5"):
		return []string{"jpeg", "png"}, "png", true
	case strings.Contains(endpoint, "minimax/h3-image"):
		return []string{"jpeg"}, "jpeg", true
	default:
		return nil, "", false
	}
}

func objectValue(value any) map[string]any {
	object, _ := value.(map[string]any)
	if object == nil {
		object = map[string]any{}
	}
	return object
}

func integerValue(value any) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case json.Number:
		value, err := typed.Int64()
		if err == nil {
			return int(value)
		}
	}
	return 0
}

func stringValues(value any) []string {
	items, _ := value.([]any)
	values := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			values = append(values, text)
		}
	}
	return values
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
