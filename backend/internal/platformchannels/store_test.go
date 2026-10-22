package platformchannels

import (
	"encoding/json"
	"testing"
)

func TestDefaultsIncludeMidjourneyImagineProfile(t *testing.T) {
	var found *ModelProfile
	for _, channel := range Defaults() {
		for index := range channel.ModelProfiles {
			if channel.ModelProfiles[index].Model == "midjourney-imagine" {
				found = &channel.ModelProfiles[index]
				break
			}
		}
	}
	if found == nil || found.Protocol != "midjourney" || found.Capability != "image" {
		t.Fatalf("Midjourney profile = %#v", found)
	}
	var config struct {
		Image struct {
			Quality struct {
				Values  []string `json:"values"`
				Default string   `json:"default"`
			} `json:"quality"`
			MaxOutputs   int `json:"maxOutputs"`
			FixedOutputs int `json:"fixedOutputs"`
		} `json:"image"`
	}
	if err := json.Unmarshal(found.CapabilityConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image.MaxOutputs != 4 || config.Image.FixedOutputs != 4 || config.Image.Quality.Default != "relax" || len(config.Image.Quality.Values) != 3 {
		t.Fatalf("Midjourney capability = %#v", config.Image)
	}
}

func TestDefaultsIncludeVerifiedMultimodalReviewProfile(t *testing.T) {
	for _, channel := range Defaults() {
		for _, profile := range channel.ModelProfiles {
			if profile.Model == "qwen/qwen3.8-omni-flash" {
				if profile.Capability != "text" || profile.Protocol != "chat-completion" {
					t.Fatalf("Qwen Omni profile = %#v", profile)
				}
				return
			}
		}
	}
	t.Fatal("default platform profiles are missing qwen/qwen3.8-omni-flash")
}

func TestSeedance25ProfileAllowsThirtySeconds(t *testing.T) {
	type durationConfig struct {
		Video struct {
			Duration struct {
				Max int `json:"max"`
			} `json:"duration"`
			References struct {
				MaxVideoDurationSeconds int `json:"maxVideoDurationSeconds"`
				MaxAudioDurationSeconds int `json:"maxAudioDurationSeconds"`
			} `json:"references"`
		} `json:"video"`
	}
	for _, tc := range []struct {
		model string
		want  int
	}{
		{model: "seedance-2.5-standard", want: 30},
		{model: "seedance-2.0-standard", want: 15},
	} {
		raw, ok := VideoCapabilityConfigForModel(tc.model)
		if !ok {
			t.Fatalf("missing capability for %s", tc.model)
		}
		var config durationConfig
		if err := json.Unmarshal(raw, &config); err != nil {
			t.Fatal(err)
		}
		if config.Video.Duration.Max != tc.want {
			t.Fatalf("%s duration max = %d, want %d", tc.model, config.Video.Duration.Max, tc.want)
		}
		if config.Video.References.MaxVideoDurationSeconds != tc.want || config.Video.References.MaxAudioDurationSeconds != tc.want {
			t.Fatalf("%s reference duration caps = %#v", tc.model, config.Video.References)
		}
	}
}
