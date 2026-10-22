// Package mediaupscale owns the narrow contract for paid media upscaling.
package mediaupscale

import (
	"errors"
	"math"
	"strings"
)

const TopazVideoModel = "Topaz-Upscale-LowPirce"

var (
	VideoResolutions = []string{"720p", "1080p", "2K", "4K"}
	VideoQualities   = []string{"Low", "Medium", "High", "Max", "Ultra"}
)

var resolutionMultiplier = map[string]float64{
	"720p":  1,
	"1080p": 2,
	"2K":    3,
	"4K":    4,
}

var qualityBasePerSecond = map[string]float64{
	"Ultra":  0.08,
	"Max":    0.06,
	"High":   0.05,
	"Medium": 0.04,
	"Low":    0.03,
}

type VideoRequest struct {
	ResourceID        string `json:"resourceId"`
	Resolution        string `json:"resolution"`
	Quality           string `json:"quality"`
	ClientOperationID string `json:"clientOperationId,omitempty"`
	ProjectID         string `json:"projectId,omitempty"`
	NodeID            string `json:"nodeId,omitempty"`
}

type Quote struct {
	UnitPriceCNYPerSecond float64 `json:"unitPriceCnyPerSecond"`
	DurationSeconds       float64 `json:"durationSeconds"`
	ReservationCNY        float64 `json:"reservationCny"`
}

func ValidateVideo(req VideoRequest) error {
	if strings.TrimSpace(req.ResourceID) == "" {
		return errors.New("请选择要超分的视频")
	}
	if _, ok := resolutionMultiplier[req.Resolution]; !ok {
		return errors.New("目标分辨率须为 720p、1080p、2K 或 4K")
	}
	if _, ok := qualityBasePerSecond[req.Quality]; !ok {
		return errors.New("超分质量须为 Low、Medium、High、Max 或 Ultra")
	}
	return nil
}

func QuoteVideo(durationMs int64, resolution, quality string) (Quote, error) {
	if durationMs <= 0 {
		return Quote{}, errors.New("视频时长尚未探测完成，请稍后重试")
	}
	if durationMs > 300_000 {
		return Quote{}, errors.New("Topaz 视频超分仅支持不超过 5 分钟的素材")
	}
	multiplier, ok := resolutionMultiplier[resolution]
	if !ok {
		return Quote{}, errors.New("目标分辨率不受支持")
	}
	base, ok := qualityBasePerSecond[quality]
	if !ok {
		return Quote{}, errors.New("超分质量不受支持")
	}
	unit := base * multiplier
	durationSeconds := float64(durationMs) / 1000
	// Keep the reservation conservative because the provider bills fractional
	// output seconds and the gateway may round its own payable amount.
	reservation := math.Ceil(unit*durationSeconds*100) / 100
	return Quote{UnitPriceCNYPerSecond: unit, DurationSeconds: durationSeconds, ReservationCNY: reservation}, nil
}

func VideoCapabilities() map[string]any {
	return map[string]any{
		"model":              TopazVideoModel,
		"mediaType":          "video",
		"resolutions":        VideoResolutions,
		"qualities":          VideoQualities,
		"defaultResolution":  "1080p",
		"defaultQuality":     "Max",
		"maxDurationMs":      300_000,
		"currency":           "CNY",
		"cloudProcessing":    true,
		"billing":            "actual_output_duration",
		"generationRequired": false,
	}
}
