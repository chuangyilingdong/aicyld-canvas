package generation

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// IsSeedanceNZVideoConfig identifies the official Seedance /v1/videos JSON
// contract. The generic OpenAI Videos multipart adapter uses resolution_name,
// which this endpoint accepts syntactically but ignores, falling back to 720p.
func IsSeedanceNZVideoConfig(config Config) bool {
	u, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil || u == nil {
		return false
	}
	return strings.EqualFold(u.Hostname(), "api.seedance.nz")
}

func IsSeedance2NZVideoConfig(config Config) bool {
	return IsSeedanceNZVideoConfig(config) && strings.Contains(strings.ToLower(config.Model), "seedance-2.0")
}

// SeedanceNZVideosBody follows the model-specific /v1/videos contract:
// seconds and resolution are JSON fields, with resolution nested in metadata.
func SeedanceNZVideosBody(input Input) (map[string]any, error) {
	body := map[string]any{"model": input.Config.Model}
	if prompt := strings.TrimSpace(input.Prompt); prompt != "" {
		body["prompt"] = prompt
	}
	body["seconds"] = strconv.Itoa(NormalizeSeedanceVideosDuration(input.Config.VideoSeconds))

	metadata := map[string]any{}
	if resolution := NormalizeSeedanceResolution(input.Config.VQuality, input.Config.Model); resolution != "" {
		metadata["resolution"] = resolution
	}
	if ratio := NormalizeSeedanceVideosRatio(input.Config.Size); ratio != "" {
		metadata["ratio"] = ratio
	}
	if VideoCapabilitySupportsAudio(input) {
		metadata["generate_audio"] = ParseBool(input.Config.VideoGenerateAudio, true)
	}
	if VideoRequestsReturnLastFrame(input) && VideoCapabilitySupportsReturnLastFrame(input) {
		metadata["return_last_frame"] = true
	}

	model := strings.ToLower(strings.TrimSpace(input.Config.Model))
	switch {
	case strings.HasSuffix(model, "-multi"):
		content, err := seedanceNZContent(input)
		if err != nil {
			return nil, err
		}
		if len(content) == 0 {
			return nil, errors.New("多模态视频至少需要一张图片、一段视频或一段音频")
		}
		metadata["content"] = content
	case strings.HasSuffix(model, "-i2v"):
		images, err := seedanceNZImages(input)
		if err != nil {
			return nil, err
		}
		if len(images) == 0 {
			return nil, errors.New("图生视频需要参考图片")
		}
		body["images"] = images
	}

	body["metadata"] = metadata
	return body, nil
}

func seedanceNZImages(input Input) ([]string, error) {
	images := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		value, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		images = append(images, value)
	}
	ordered, err := VideoFrameImageURLs(input, images)
	if err != nil {
		return nil, err
	}
	if len(ordered) > 0 {
		return ordered, nil
	}
	return images, nil
}

func seedanceNZContent(input Input) ([]map[string]any, error) {
	content := make([]map[string]any, 0, len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios))
	for _, image := range input.ReferenceImages {
		value, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": value}})
	}
	for _, video := range input.ReferenceVideos {
		value, err := SeedanceVideosMediaURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]any{"type": "video_url", "video_url": map[string]any{"url": value}})
	}
	for _, audio := range input.ReferenceAudios {
		value, err := SeedanceVideosMediaURL(audio)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": value}})
	}
	return content, nil
}
