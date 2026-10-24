package modelcatalog

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf16"

	"infinite-canvas/backend/internal/kernel"
)

var sora2PromptPattern = regexp.MustCompile(`^sora-2(?:-pro)?$`)

// videoPromptLimits describes limits published by the selected endpoint. A zero
// value means the endpoint has no documented local ceiling and the provider
// remains responsible for rejecting overlong prompts.
func videoPromptLimits(protocol, modelName string) (chars, utf16Units int) {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	parts := strings.Split(strings.ToLower(strings.TrimSpace(modelName)), "/")
	name := parts[len(parts)-1]
	switch protocol {
	case "full-video":
		chars = 4000
	case "openai", "openai-videos", "newapi":
		if sora2PromptPattern.MatchString(name) {
			chars = 32000
		}
	case "minimax-video", "minimax-h3-v2":
		if isMiniMaxH3PromptModel(name) {
			chars = 7000
		}
	case "newapi-channel-2":
		if isMiniMaxH3PromptModel(name) {
			chars = 7000
		}
		if limit, ok := wanPromptLimit(name); ok {
			chars = limit
		}
	case "dashscope-wan-video":
		if limit, ok := wanPromptLimit(name); ok {
			chars = limit
		}
	case "volcengine-jimeng-video":
		if name == "jimeng_t2v_v30" {
			chars = 800
		}
	case "luma-dream-machine":
		if name == "ray-2" || name == "ray-flash-2" {
			chars = 5000
		}
	case "pixverse-video":
		switch name {
		case "v6-max", "c1", "v6", "v3.5", "v4", "v4.5", "v5", "v5-fast", "v5.5", "v5.6":
			chars = 5000
		}
	case "zhipu-cogvideox":
		switch name {
		case "cogvideox-3", "cogvideox-2", "cogvideox-flash", "viduq1-text", "viduq1-image", "vidu2-image", "viduq1-start-end", "vidu2-start-end", "vidu2-reference":
			chars = 512
		}
	case "runway-video":
		switch name {
		case "gen4.5", "gen4_turbo", "veo3.1", "veo3.1_fast":
			utf16Units = 1000
		case "happyhorse_1_0":
			utf16Units = 2500
		case "seedance2_5":
			chars = 15000
		case "seedance2", "seedance2_fast", "seedance2_mini":
			chars = 3500
		case "hailuo3", "h3_max":
			chars = 6000
		case "klingo3_4k", "kling3.0_4k", "kling2.5_turbo_pro", "kling3.0_pro", "kling3.0_standard", "klingo3_pro", "klingo3_standard", "grok_imagine_1_5", "grok_imagine_1_5_lite":
			chars = 2500
		case "wan3", "wan3_prime":
			chars = 20000
		case "gemini_omni_flash", "gemini_omni_flash_1.1":
			chars = 4000
		}
	}
	return
}

func isMiniMaxH3PromptModel(name string) bool {
	return name == "minimax-h3" || name == "minimax-h3-max" || name == "minimax-h3-max-turbo" || strings.HasPrefix(name, "hailuo-h3-max")
}

func wanPromptLimit(name string) (int, bool) {
	switch {
	case strings.HasPrefix(name, "wan3.0"), strings.HasPrefix(name, "wan3-0"):
		return 20000, true
	case strings.HasPrefix(name, "wan2.7"), strings.HasPrefix(name, "wan2-7"):
		return 5000, true
	case strings.HasPrefix(name, "wan2.5"), strings.HasPrefix(name, "wan2-5"), strings.HasPrefix(name, "wan2.6"), strings.HasPrefix(name, "wan2-6"):
		return 1500, true
	case strings.HasPrefix(name, "wan2.1"), strings.HasPrefix(name, "wan2-1"), strings.HasPrefix(name, "wan2.2"), strings.HasPrefix(name, "wan2-2"):
		return 800, true
	default:
		return 0, false
	}
}

func validateVideoPromptLength(prompt string, references VideoReferenceConfig) error {
	if err := validateModelPromptLength("视频", prompt, references.PromptMaxChars); err != nil {
		return err
	}
	if max := references.PromptMaxUTF16Units; max > 0 {
		if actual := len(utf16.Encode([]rune(prompt))); actual > max {
			return kernel.BadAuthRequest(fmt.Sprintf("当前视频通道提示词最多 %d 个 UTF-16 单位（部分表情占 2 个单位），完整提示词为 %d 个单位。请精简后重试", max, actual))
		}
	}
	return nil
}
