package generation

import "testing"

func TestTopazVideoUpscaleBodyUsesVideoMetadataContract(t *testing.T) {
	body, err := TopazVideoUpscaleBody(Input{
		Mode:   "video",
		Config: Config{Model: "Topaz-Upscale-LowPirce", VQuality: "1080p", Quality: "Max"},
		ReferenceVideos: []Media{{
			ID: "video-1", URL: "https://cdn.example.com/source.mp4",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	metadata, _ := body["metadata"].(map[string]any)
	urls, _ := metadata["video_url"].([]string)
	if body["model"] != "Topaz-Upscale-LowPirce" || len(urls) != 1 || urls[0] != "https://cdn.example.com/source.mp4" || metadata["resolution"] != "1080p" || metadata["quality"] != "Max" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestTopazVideoPollReadsNestedContentURL(t *testing.T) {
	status, url := topazVideoPollStatusAndURL(map[string]any{
		"status":  "SUCCESS",
		"content": map[string]any{"url": "https://cdn.example.com/upscaled.mp4"},
	})
	if status != "success" || url != "https://cdn.example.com/upscaled.mp4" {
		t.Fatalf("unexpected poll result: %s %s", status, url)
	}
}
