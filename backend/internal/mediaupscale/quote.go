// Package mediaupscale owns the narrow contract for paid media upscaling.
package mediaupscale

import (
	"errors"
	"math"
	"strings"
)

const (
	TopazVideoModel    = "Topaz-Upscale-LowPirce"
	VOSR2ImageModel    = "vosr2-image-upscale"
	VOSR2VideoModel    = "vosr2-video-upscale"
	FlashVSRVideoModel = "FlashVSR_video_upscale"
)

var (
	TopazResolutions = []string{"720p", "1080p", "2K", "4K"}
	TopazQualities   = []string{"Low", "Medium", "High", "Max", "Ultra"}
)

var topazResolutionMultiplier = map[string]float64{
	"720p":  1,
	"1080p": 2,
	"2K":    3,
	"4K":    4,
}

var topazQualityBasePerSecond = map[string]float64{
	"Ultra":  0.08,
	"Max":    0.06,
	"High":   0.05,
	"Medium": 0.04,
	"Low":    0.03,
}

type Model struct {
	ID                string   `json:"id"`
	Label             string   `json:"label"`
	MediaType         string   `json:"mediaType"`
	Billing           string   `json:"billing"`
	Resolutions       []string `json:"resolutions,omitempty"`
	Qualities         []string `json:"qualities,omitempty"`
	DefaultResolution string   `json:"defaultResolution,omitempty"`
	DefaultQuality    string   `json:"defaultQuality,omitempty"`
	FixedPriceCNY     float64  `json:"fixedPriceCny,omitempty"`
	MaxDurationMs     int64    `json:"maxDurationMs,omitempty"`
	MinDurationMs     int64    `json:"minDurationMs,omitempty"`
	OutputResolution  string   `json:"outputResolution,omitempty"`
	InputConstraint   string   `json:"inputConstraint,omitempty"`
}

func Models() []Model {
	return []Model{
		{
			ID: TopazVideoModel, Label: "Topaz 视频超分", MediaType: "video", Billing: "actual_output_duration",
			Resolutions: TopazResolutions, Qualities: TopazQualities,
			DefaultResolution: "1080p", DefaultQuality: "Max", MaxDurationMs: 300_000,
			InputConstraint: "MP4/MOV，最长 5 分钟",
		},
		{
			ID: VOSR2ImageModel, Label: "VOSR2 图片超分", MediaType: "image", Billing: "fixed_per_request",
			FixedPriceCNY: 0.10, OutputResolution: "4K",
			InputConstraint: "单张 PNG/JPEG/WebP",
		},
		{
			ID: VOSR2VideoModel, Label: "VOSR2 视频超分", MediaType: "video", Billing: "fixed_per_request",
			FixedPriceCNY: 1, OutputResolution: "2K", MaxDurationMs: 300_000,
			InputConstraint: "MP4/MOV，最长 5 分钟",
		},
		{
			ID: FlashVSRVideoModel, Label: "FlashVSR 视频超分", MediaType: "video", Billing: "fixed_per_request",
			FixedPriceCNY: 1, OutputResolution: "1080p", MaxDurationMs: 15_000, MinDurationMs: 3_000,
			InputConstraint: "480P MP4，3–15 秒",
		},
	}
}

func FindModel(id string) (Model, bool) {
	id = strings.TrimSpace(id)
	if id == "" {
		id = TopazVideoModel
	}
	for _, model := range Models() {
		if model.ID == id {
			return model, true
		}
	}
	return Model{}, false
}

type Request struct {
	Model             string `json:"model,omitempty"`
	ResourceID        string `json:"resourceId"`
	Resolution        string `json:"resolution,omitempty"`
	Quality           string `json:"quality,omitempty"`
	ClientOperationID string `json:"clientOperationId,omitempty"`
	ProjectID         string `json:"projectId,omitempty"`
	NodeID            string `json:"nodeId,omitempty"`
}

type Quote struct {
	UnitPriceCNYPerSecond float64 `json:"unitPriceCnyPerSecond"`
	FixedPriceCNY         float64 `json:"fixedPriceCny,omitempty"`
	DurationSeconds       float64 `json:"durationSeconds"`
	ReservationCNY        float64 `json:"reservationCny"`
}

func NormalizeRequest(request Request) (Request, Model, error) {
	request.Model = strings.TrimSpace(request.Model)
	model, ok := FindModel(request.Model)
	if !ok {
		return request, Model{}, errors.New("不支持的超分模型")
	}
	request.Model = model.ID
	if strings.TrimSpace(request.ResourceID) == "" {
		return request, model, errors.New("请选择要超分的素材")
	}
	if model.ID == TopazVideoModel {
		if _, ok := topazResolutionMultiplier[request.Resolution]; !ok {
			return request, model, errors.New("目标分辨率须为 720p、1080p、2K 或 4K")
		}
		if _, ok := topazQualityBasePerSecond[request.Quality]; !ok {
			return request, model, errors.New("超分质量须为 Low、Medium、High、Max 或 Ultra")
		}
	}
	return request, model, nil
}

func QuoteModel(model Model, durationMs int64, width, height int) (Quote, error) {
	if model.MediaType == "video" {
		if durationMs <= 0 {
			return Quote{}, errors.New("视频时长尚未探测完成，请稍后重试")
		}
		if model.MaxDurationMs > 0 && durationMs > model.MaxDurationMs {
			return Quote{}, errors.New("源视频超过当前超分模型的最长时长限制")
		}
		if model.MinDurationMs > 0 && durationMs < model.MinDurationMs {
			return Quote{}, errors.New("源视频短于当前超分模型的最短时长限制")
		}
	}
	if model.ID == FlashVSRVideoModel && width > 0 && height > 0 && min(width, height) > 576 {
		return Quote{}, errors.New("FlashVSR 仅支持 480P 源视频")
	}
	durationSeconds := float64(durationMs) / 1000
	if model.Billing == "fixed_per_request" {
		return Quote{
			FixedPriceCNY: model.FixedPriceCNY, DurationSeconds: durationSeconds,
			ReservationCNY: math.Ceil(model.FixedPriceCNY*100) / 100,
		}, nil
	}
	if model.ID != TopazVideoModel {
		return Quote{}, errors.New("当前超分模型缺少计费规则")
	}
	unit := topazQualityBasePerSecond[model.DefaultQuality] * topazResolutionMultiplier[model.DefaultResolution]
	// The caller supplies the selected Topaz tier through QuoteTopaz below.
	return Quote{UnitPriceCNYPerSecond: unit, DurationSeconds: durationSeconds, ReservationCNY: math.Ceil(unit*durationSeconds*100) / 100}, nil
}

func QuoteTopaz(durationMs int64, resolution, quality string) (Quote, error) {
	if durationMs <= 0 {
		return Quote{}, errors.New("视频时长尚未探测完成，请稍后重试")
	}
	if durationMs > 300_000 {
		return Quote{}, errors.New("Topaz 视频超分仅支持不超过 5 分钟的素材")
	}
	multiplier, ok := topazResolutionMultiplier[resolution]
	if !ok {
		return Quote{}, errors.New("目标分辨率不受支持")
	}
	base, ok := topazQualityBasePerSecond[quality]
	if !ok {
		return Quote{}, errors.New("超分质量不受支持")
	}
	unit := base * multiplier
	durationSeconds := float64(durationMs) / 1000
	reservation := math.Ceil(unit*durationSeconds*100) / 100
	return Quote{UnitPriceCNYPerSecond: unit, DurationSeconds: durationSeconds, ReservationCNY: reservation}, nil
}

func Capabilities() map[string]any {
	return map[string]any{
		"models":          Models(),
		"currency":        "CNY",
		"cloudProcessing": true,
	}
}
