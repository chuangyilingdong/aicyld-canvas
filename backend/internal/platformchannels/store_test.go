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
			MaxOutputs int `json:"maxOutputs"`
		} `json:"image"`
	}
	if err := json.Unmarshal(found.CapabilityConfig, &config); err != nil {
		t.Fatal(err)
	}
	if config.Image.MaxOutputs != 1 || config.Image.Quality.Default != "relax" || len(config.Image.Quality.Values) != 3 {
		t.Fatalf("Midjourney capability = %#v", config.Image)
	}
}
