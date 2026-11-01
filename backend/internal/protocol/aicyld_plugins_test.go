package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAICYLDShippedSourcePluginsLoad(t *testing.T) {
	cases := []struct {
		plugin     string
		providerID string
		capability Capability
	}{
		{plugin: "minimax-h3-v2", providerID: "minimax-h3-v2", capability: CapabilityVideo},
		{plugin: "newapi-image-task", providerID: "newapi-image", capability: CapabilityImage},
		{plugin: "suno-sfx", providerID: "suno-sfx", capability: CapabilityAudio},
	}
	for _, tc := range cases {
		t.Run(tc.plugin, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", tc.plugin, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			adapters, err := LoadInstalledProviders(raw, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(adapters) != 1 {
				t.Fatalf("adapters = %d, want 1", len(adapters))
			}
			metadata := adapters[0].Metadata()
			if metadata.ID != tc.providerID {
				t.Fatalf("provider id = %q, want %q", metadata.ID, tc.providerID)
			}
			found := false
			for _, capability := range metadata.Categories {
				found = found || capability == tc.capability
			}
			if !found {
				t.Fatalf("provider %s capabilities = %v, want %s", metadata.ID, metadata.Categories, tc.capability)
			}
		})
	}
}
