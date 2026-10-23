package app

import (
	"slices"
	"testing"
)

func TestPlatformModelCapabilityDefaultsUseVerifiedVideoContracts(t *testing.T) {
	tests := []struct {
		name          string
		model         string
		protocol      string
		durationMin   int
		durationMax   int
		resolutions   []string
		maxImages     int
		maxVideos     int
		maxAudios     int
		generateAudio bool
	}{
		{name: "seedance 2.0", model: "seedance-2.0-fast", protocol: "newapi", durationMin: 4, durationMax: 15, resolutions: []string{"480p", "720p", "1080p"}, maxImages: 9, maxVideos: 3, maxAudios: 3, generateAudio: true},
		{name: "minimax h3 max", model: "minimax-h3-max", protocol: "newapi-channel-2", durationMin: 5, durationMax: 15, resolutions: []string{"480p", "768p"}, maxImages: 2, maxVideos: 0, maxAudios: 1, generateAudio: false},
		{name: "kling v3", model: "kling-video-v3", protocol: "newapi", durationMin: 3, durationMax: 15, resolutions: []string{"720p"}, maxImages: 1, maxVideos: 0, maxAudios: 0, generateAudio: true},
		{name: "grok imagine", model: "grok-imagine-video-1.5", protocol: "newapi", durationMin: 1, durationMax: 15, resolutions: []string{"480p", "720p", "1080p"}, maxImages: 1, maxVideos: 0, maxAudios: 0, generateAudio: true},
		{name: "wan 3.0", model: "wan3.0-video", protocol: "newapi-channel-2", durationMin: 1, durationMax: 15, resolutions: []string{"480p", "720p", "1080p", "1440p", "2160p"}, maxImages: 1, maxVideos: 0, maxAudios: 0, generateAudio: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			config, err := platformModelCapabilityConfig(PlatformChannelModel{
				Model: test.model, Capability: "video", Protocol: test.protocol,
			}, "")
			if err != nil {
				t.Fatal(err)
			}
			if config == nil || config.Video == nil {
				t.Fatal("video capability is nil")
			}
			video := config.Video
			if video.Duration.Min != test.durationMin || video.Duration.Max != test.durationMax {
				t.Fatalf("duration = %#v, want %d-%d", video.Duration, test.durationMin, test.durationMax)
			}
			if !slices.Equal(video.Resolutions, test.resolutions) {
				t.Fatalf("resolutions = %v, want %v", video.Resolutions, test.resolutions)
			}
			if video.References.MaxImages != test.maxImages || video.References.MaxVideos != test.maxVideos || video.References.MaxAudios != test.maxAudios {
				t.Fatalf("references = %#v", video.References)
			}
			if video.GenerateAudio.Supported != test.generateAudio {
				t.Fatalf("generateAudio = %#v, want supported=%v", video.GenerateAudio, test.generateAudio)
			}
		})
	}
}
