package app

import (
	"encoding/json"
	"testing"
)

func TestPlatformModelCapabilityDefaultsProduceUsableVideoProfiles(t *testing.T) {
	for _, tc := range []struct {
		model    string
		protocol string
	}{
		{model: "seedance-2.0-fast", protocol: "newapi"},
		{model: "minimax-h3-max", protocol: "newapi-channel-2"},
		{model: "kling-video-v3", protocol: "newapi"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			config, err := platformModelCapabilityConfig(PlatformChannelModel{Model: tc.model, Capability: "video", Protocol: tc.protocol}, "")
			if err != nil {
				t.Fatal(err)
			}
			if config == nil || config.Video == nil {
				t.Fatal("video capability is nil")
			}
			if config.Video.Duration.Max < config.Video.Duration.Min || config.Video.Duration.Min <= 0 {
				t.Fatalf("invalid duration = %#v", config.Video.Duration)
			}
			if len(config.Video.Resolutions) == 0 || config.Video.DefaultResolution == "" {
				t.Fatalf("missing resolutions = %#v", config.Video)
			}
		})
	}
}

func TestPlatformModelCapabilityPrefersSubmittedConfig(t *testing.T) {
	raw := json.RawMessage(`{"version":1,"video":{"duration":{"selection":"range","min":8,"max":12,"step":1,"default":10},"resolutions":["720p"],"defaultResolution":"720p","operations":["text_to_video"],"defaultOperation":"text_to_video"}}`)
	config, err := platformModelCapabilityConfig(PlatformChannelModel{
		Model: "custom-video", Capability: "video", Protocol: "newapi", CapabilityConfig: raw,
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if config == nil || config.Video == nil || config.Video.Duration.Min != 8 || config.Video.Duration.Max != 12 {
		t.Fatalf("submitted capability was not preserved: %#v", config)
	}
}

func TestPlatformModelCapabilityRejectsUnknownCapability(t *testing.T) {
	if _, err := platformModelCapabilityConfig(PlatformChannelModel{Model: "unknown", Capability: "unknown", Protocol: "newapi"}, ""); err == nil {
		t.Fatal("unknown capability must fail")
	}
}
