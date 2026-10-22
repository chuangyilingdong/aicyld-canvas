package generation

import (
	"fmt"
	"strconv"
	"strings"
)

func IsBeefAPIH3Model(model string) bool {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "minimax-h3", "minimax-h3-max", "minimax-h3-max-turbo",
		"hailuo-h3-max-t2v", "hailuo-h3-max-i2v", "hailuo-h3-max-turbo-t2v", "hailuo-h3-max-turbo-i2v":
		return true
	default:
		return false
	}
}

// H3's two images are keyframes, not Seedance subject references. The end
// frame may stand alone, and its canvas inherits the image's aspect ratio.
func beefAPIH3VideoBody(input Input) (map[string]interface{}, error) {
	name := strings.ToLower(strings.TrimSpace(input.Config.Model))
	base := name == "minimax-h3"
	maxModel := strings.Contains(name, "h3-max")
	first, last, middle := metadataString(input.Metadata, "videoStartFrameNodeId"), metadataString(input.Metadata, "videoEndFrameNodeId"), metadataString(input.Metadata, "videoMiddleFrameNodeId")
	references := base && (metadataString(input.Metadata, "videoEditOperation") == "reference_to_video" || len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 1 || len(input.ReferenceImages) > 0 && first == "" && last == "")
	if references {
		if first != "" || last != "" || middle != "" {
			return nil, fmt.Errorf("H3 多素材参考不能同时指定首帧或尾帧")
		}
		if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 || len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios) > 12 {
			return nil, fmt.Errorf("H3 最多支持 9 张参考图、3 段视频、3 段音频，合计不超过 12 个素材")
		}
	} else if len(input.ReferenceImages) > boolInt(maxModel && middle != "", 3, 2) || len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 1 {
		return nil, fmt.Errorf("H3 首尾帧模式支持最多 2 张图片、1 段配音，不支持参考视频")
	}
	seconds := strings.TrimSpace(input.Config.VideoSeconds)
	if seconds == "" {
		seconds = "6"
	}
	duration, err := strconv.Atoi(seconds)
	minDuration := 5
	if base {
		minDuration = 4
	}
	maxDuration := 15
	if base && len(input.ReferenceAudios) == 1 && !references {
		maxDuration = 60
	}
	if err != nil || duration < minDuration || duration > maxDuration {
		if maxDuration > 15 {
			return nil, fmt.Errorf("H3 视频时长须为 %d–%d 秒整数", minDuration, maxDuration)
		}
		return nil, fmt.Errorf("H3 视频时长须为 %d–15 秒整数", minDuration)
	}
	resolution := "768p"
	if strings.TrimSpace(input.Config.VQuality) != "" {
		switch strings.ToLower(strings.TrimSpace(input.Config.VQuality)) {
		case "2k", "1440", "1440p":
			resolution = "2k"
		case "4k", "2160", "2160p":
			resolution = "4k"
		default:
			resolution = NormalizeVideoResolution(input.Config.VQuality)
		}
	}
	if resolution != "480p" && resolution != "768p" && !(base && resolution == "1080p") {
		return nil, fmt.Errorf("所选分辨率不受当前 H3 模型支持")
	}
	body := map[string]interface{}{"model": input.Config.Model, "prompt": strings.TrimSpace(input.Prompt), "seconds": seconds, "resolution": resolution}
	if references {
		images, videos, audios := []string{}, []string{}, []string{}
		for _, media := range input.ReferenceImages {
			url, err := openAIImageInputURL(media)
			if err != nil {
				return nil, err
			}
			images = append(images, url)
		}
		for _, media := range input.ReferenceVideos {
			url, err := SeedanceVideosMediaURL(media)
			if err != nil {
				return nil, err
			}
			videos = append(videos, url)
		}
		for _, media := range input.ReferenceAudios {
			url, err := BeefAPIAudioURL(media)
			if err != nil {
				return nil, err
			}
			audios = append(audios, url)
		}
		body["operation"] = "reference_to_video"
		if len(images) > 0 {
			body["reference_image_urls"] = images
		}
		if len(videos) > 0 {
			body["reference_video_urls"] = videos
		}
		if len(audios) > 0 {
			body["reference_audio_urls"] = audios
		}
		body["aspect_ratio"] = defaultString(strings.TrimSpace(input.Config.Size), "adaptive")
		return body, nil
	}
	for index, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		if first != "" || last != "" || middle != "" {
			matched := false
			if image.ID == first {
				body["first_frame_url"] = url
				matched = true
			}
			if image.ID == last {
				body["last_frame_url"] = url
				matched = true
			}
			if image.ID == middle {
				body["middle_image_url"] = url
				matched = true
			}
			if !matched {
				return nil, fmt.Errorf("H3 的图片须指定为首帧或尾帧")
			}
		} else if index == 0 {
			body["first_frame_url"] = url
		} else {
			body["last_frame_url"] = url
		}
	}
	if first != "" && body["first_frame_url"] == nil || last != "" && body["last_frame_url"] == nil || middle != "" && body["middle_image_url"] == nil {
		return nil, fmt.Errorf("已选择的首尾帧未包含在视频请求中")
	}
	if middle != "" || input.Metadata["videoMiddleFrameTime"] != nil {
		time, ok := input.Metadata["videoMiddleFrameTime"].(float64)
		frame := int(time*24 + 0.5)
		if !ok || !maxModel || middle == "" || first == "" || last == "" || frame <= 0 || frame >= duration*24-1 || resolution == "1080p" || resolution == "2k" || resolution == "4k" {
			return nil, fmt.Errorf("中间帧须同时指定首尾帧和片内时间，并使用 H3 Max 的 480P 或 768P")
		}
		body["middle_frame_time"] = time
	}
	if len(input.ReferenceImages) == 0 {
		body["aspect_ratio"] = defaultString(strings.TrimSpace(input.Config.Size), "16:9")
		if body["aspect_ratio"] == "adaptive" {
			return nil, fmt.Errorf("自适应比例仅支持多素材参考，请选择固定比例")
		}
	}
	if len(input.ReferenceAudios) > 0 {
		if duration < 2 {
			return nil, fmt.Errorf("使用配音时视频须至少 2 秒")
		}
		url, err := BeefAPIAudioURL(input.ReferenceAudios[0])
		if err != nil {
			return nil, err
		}
		body["target_audio_url"] = url
	}
	return body, nil
}

func boolInt(condition bool, whenTrue, whenFalse int) int {
	if condition {
		return whenTrue
	}
	return whenFalse
}
