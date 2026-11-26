package protocol

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

func runningHubMagiVideoFields(body map[string]any, endpoint string, request GenerationRequest) error {
	images, mask := runningHubImages(request.Images)
	videos := runningHubMediaValues(request.Videos)
	audios := runningHubMediaValues(request.Audios)
	if mask != "" {
		return fmt.Errorf("MAGI-2 不支持蒙版输入")
	}
	switch {
	case strings.HasSuffix(endpoint, "/text-to-video"):
		if len(images)+len(videos)+len(audios) > 0 {
			return fmt.Errorf("MAGI-2 文生视频不能传入参考素材")
		}
	case strings.HasSuffix(endpoint, "/image-to-video"):
		if len(images) < 1 || len(images) > 2 || len(videos)+len(audios) > 0 {
			return fmt.Errorf("MAGI-2 图生视频需要 1 到 2 张图片")
		}
		body["imageUrl"] = images[0]
		if len(images) == 2 {
			body["endImageUrl"] = images[1]
		}
	case strings.HasSuffix(endpoint, "/reference-to-video"):
		if len(images) > 0 {
			body["imageUrls"] = images
		}
		if len(videos) > 0 {
			body["videoUrls"] = videos
		}
		if len(audios) > 0 {
			body["audioUrls"] = audios
		}
	default:
		return fmt.Errorf("MAGI-2 生成模式无效")
	}
	duration := strconv.Itoa(request.Duration)
	if request.Duration == 0 {
		duration = defaultValue(runningHubExtraString(request.Extra, "videoSeconds"), "5")
	}
	body["duration"] = duration
	body["aspectRatio"] = defaultValue(request.AspectRatio, "16:9")
	body["resolution"] = defaultValue(request.Resolution, "1080p")
	body["generateAudio"] = request.GenerateAudio
	if seed, exists := request.Extra["seed"]; exists {
		body["seed"] = seed
	}
	return nil
}

func validateRunningHubMagiPayload(endpoint string, body map[string]any) error {
	prompt, _ := body["prompt"].(string)
	if !strings.HasSuffix(endpoint, "/image-to-video") && strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("MAGI-2 文生视频和参考生视频需要提示词")
	}
	if utf8.RuneCountInString(prompt) > 15000 {
		return fmt.Errorf("MAGI-2 提示词最多支持 15000 个字符")
	}
	duration, err := strconv.Atoi(fmt.Sprint(body["duration"]))
	if err != nil || duration < 4 || duration > 30 {
		return fmt.Errorf("MAGI-2 输出时长必须为 4 到 30 的整数秒")
	}
	switch body["aspectRatio"] {
	case "21:9", "16:9", "4:3", "1:1", "3:4", "9:16":
	default:
		return fmt.Errorf("MAGI-2 画面比例不受支持")
	}
	if body["resolution"] != "1080p" {
		return fmt.Errorf("MAGI-2 仅支持 1080p")
	}
	if seed, exists := body["seed"]; exists {
		value, err := strconv.ParseInt(fmt.Sprint(seed), 10, 64)
		if err != nil || value < 0 || value > 2147483647 {
			return fmt.Errorf("MAGI-2 seed 必须为 0 到 2147483647 的整数")
		}
	}
	if strings.HasSuffix(endpoint, "/image-to-video") && !runningHubPayloadString(body, "imageUrl") {
		return fmt.Errorf("MAGI-2 图生视频缺少 imageUrl")
	}
	if strings.HasSuffix(endpoint, "/reference-to-video") {
		images := runningHubPayloadStrings(body, "imageUrls")
		videos := runningHubPayloadStrings(body, "videoUrls")
		audios := runningHubPayloadStrings(body, "audioUrls")
		if len(images)+len(videos)+len(audios) == 0 {
			return fmt.Errorf("MAGI-2 参考生视频至少需要一种参考素材")
		}
		if len(images) > 10 || len(videos) > 5 || len(audios) > 5 {
			return fmt.Errorf("MAGI-2 最多支持 10 张图片、5 段视频和 5 段音频")
		}
	}
	return nil
}
