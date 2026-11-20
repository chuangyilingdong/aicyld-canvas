package platformchannels

import (
	"encoding/json"
	"testing"
)

func TestRepairKnownCapabilityRestoresProtocolMediaRequirements(t *testing.T) {
	tests := []struct {
		name       string
		capability string
		endpoint   string
		config     string
		assert     func(*testing.T, map[string]any)
	}{
		{
			name:       "layer decomposition keeps its source image",
			capability: "image",
			endpoint:   "seedream-v5.5/layer-decomposition",
			config:     `{"version":1,"image":{"references":{"maxImages":0}}}`,
			assert: func(t *testing.T, root map[string]any) {
				image := objectValue(root["image"])
				references := objectValue(image["references"])
				if integerValue(references["maxImages"]) != 1 {
					t.Fatalf("maxImages = %v", references["maxImages"])
				}
				size := objectValue(image["size"])
				quality := objectValue(image["quality"])
				if size["parameter"] != "none" || quality["supported"] != true {
					t.Fatalf("layer size/quality = %#v / %#v", size, quality)
				}
				if got := stringValues(quality["values"]); len(got) != 4 || got[2] != "1.5k" {
					t.Fatalf("layer resolutions = %#v", got)
				}
			},
		},
		{
			name:       "first last frame accepts two images",
			capability: "video",
			endpoint:   "bytedance/seedance-2.5-token/image-to-video",
			config:     `{"version":1,"video":{"references":{"minImages":1,"maxImages":1},"operations":["image_to_video","first_last_frame"],"defaultOperation":"image_to_video"}}`,
			assert: func(t *testing.T, root map[string]any) {
				references := objectValue(objectValue(root["video"])["references"])
				if integerValue(references["minImages"]) != 1 || integerValue(references["maxImages"]) != 2 {
					t.Fatalf("image range = %v-%v", references["minImages"], references["maxImages"])
				}
			},
		},
		{
			name:       "motion control accepts its source image",
			capability: "video",
			endpoint:   "kling-v3.0-pro/motion-control",
			config:     `{"version":1,"video":{"references":{"minImages":0,"maxImages":0,"maxVideos":1},"operations":["video_to_video"],"defaultOperation":"video_to_video"}}`,
			assert: func(t *testing.T, root map[string]any) {
				references := objectValue(objectValue(root["video"])["references"])
				if integerValue(references["minImages"]) != 1 || integerValue(references["maxImages"]) != 1 {
					t.Fatalf("image range = %v-%v", references["minImages"], references["maxImages"])
				}
			},
		},
		{
			name:       "avatar requires image and audio",
			capability: "video",
			endpoint:   "kling-v2-ai-avatar-standard/image-audio-to-video",
			config:     `{"version":1,"video":{"references":{"minImages":0,"maxImages":0,"maxAudios":1},"operations":["image_to_video","audio_to_video"],"defaultOperation":"image_to_video"}}`,
			assert: func(t *testing.T, root map[string]any) {
				video := objectValue(root["video"])
				references := objectValue(video["references"])
				operations := stringValues(video["operations"])
				if integerValue(references["minImages"]) != 1 || integerValue(references["maxImages"]) != 1 {
					t.Fatalf("image range = %v-%v", references["minImages"], references["maxImages"])
				}
				if len(operations) != 1 || operations[0] != "audio_to_video" || video["defaultOperation"] != "audio_to_video" {
					t.Fatalf("operations = %v default = %v", operations, video["defaultOperation"])
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repaired := repairKnownCapability(ModelProfile{
				Model:            "test-model",
				Capability:       test.capability,
				Protocol:         "runninghub-standard-" + test.capability,
				ProviderModelKey: test.endpoint,
				CapabilityConfig: json.RawMessage(test.config),
			})
			var root map[string]any
			if err := json.Unmarshal(repaired.CapabilityConfig, &root); err != nil {
				t.Fatal(err)
			}
			test.assert(t, root)
		})
	}
}

func TestRepairSeedanceFlashImageVideoOnlyAllowsAdaptiveRatio(t *testing.T) {
	repaired := repairKnownCapability(ModelProfile{
		Model:            "rh-seedance-2.5-flash-i2v",
		Capability:       "video",
		Protocol:         "runninghub-standard-video",
		ProviderModelKey: "bytedance/seedance-2.5-flash-token/image-to-video",
		CapabilityConfig: json.RawMessage(`{"version":1,"video":{"ratios":["adaptive","16:9","9:16"],"defaultRatio":"16:9"}}`),
	})
	var root map[string]any
	if err := json.Unmarshal(repaired.CapabilityConfig, &root); err != nil {
		t.Fatal(err)
	}
	video := objectValue(root["video"])
	ratios := stringValues(video["ratios"])
	if len(ratios) != 1 || ratios[0] != "adaptive" || video["defaultRatio"] != "adaptive" {
		t.Fatalf("ratios = %v default = %v", ratios, video["defaultRatio"])
	}
}

func TestRepairHidesProviderUnavailableKlingTTS(t *testing.T) {
	repaired := repairKnownCapability(ModelProfile{
		Model:            "rh-kling-lipsync-tts",
		Capability:       "audio",
		Protocol:         "runninghub-standard-audio",
		ProviderModelKey: "kling-lip-sync/tts",
		CapabilityConfig: json.RawMessage(`{"version":1,"audio":{}}`),
	})
	if !repaired.Hidden {
		t.Fatal("Kling TTS must stay hidden while the provider returns error 1000")
	}
}
