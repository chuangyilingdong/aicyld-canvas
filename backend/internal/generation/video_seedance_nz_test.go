package generation

import "testing"

func TestSeedanceNZVideosBodyUsesJSONMetadataContract(t *testing.T) {
	body, err := SeedanceNZVideosBody(Input{
		Mode:   "video",
		Prompt: "a red ball rolls slowly",
		Config: Config{
			BaseURL:            "https://api.seedance.nz",
			Model:              "seedance-2.0-fast-t2v",
			VQuality:           "480p",
			VideoSeconds:       "4",
			Size:               "16:9",
			VideoGenerateAudio: "false",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if body["model"] != "seedance-2.0-fast-t2v" || body["seconds"] != "4" {
		t.Fatalf("unexpected top-level body: %#v", body)
	}
	if _, exists := body["resolution_name"]; exists {
		t.Fatalf("legacy multipart field leaked into JSON body: %#v", body)
	}
	metadata, _ := body["metadata"].(map[string]any)
	if metadata["resolution"] != "480p" || metadata["ratio"] != "16:9" || metadata["generate_audio"] != false {
		t.Fatalf("unexpected metadata: %#v", metadata)
	}
}

func TestSeedanceNZVideosBodyUsesContentForMultiModel(t *testing.T) {
	body, err := SeedanceNZVideosBody(Input{
		Mode:   "video",
		Prompt: "combine the references",
		Config: Config{
			BaseURL:            "https://api.seedance.nz",
			Model:              "seedance-2.0-fast-multi",
			VQuality:           "720p",
			VideoSeconds:       "5",
			Size:               "9:16",
			VideoGenerateAudio: "true",
		},
		ReferenceImages: []Media{{URL: "https://cdn.example.com/reference.png"}},
		ReferenceVideos: []Media{{URL: "https://cdn.example.com/reference.mp4"}},
		ReferenceAudios: []Media{{URL: "https://cdn.example.com/reference.mp3"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	metadata, _ := body["metadata"].(map[string]any)
	content, _ := metadata["content"].([]map[string]any)
	if len(content) != 3 {
		t.Fatalf("content = %#v", metadata["content"])
	}
	if content[0]["type"] != "image_url" || content[1]["type"] != "video_url" || content[2]["type"] != "audio_url" {
		t.Fatalf("unexpected content ordering: %#v", content)
	}
	if _, exists := body["images"]; exists {
		t.Fatalf("multi model must not mix top-level images with content: %#v", body)
	}
}

func TestSeedanceNZConfigDetection(t *testing.T) {
	if !IsSeedanceNZVideoConfig(Config{BaseURL: "https://api.seedance.nz/v1"}) {
		t.Fatal("official Seedance host was not detected")
	}
	if IsSeedanceNZVideoConfig(Config{BaseURL: "https://example.com"}) {
		t.Fatal("unrelated host selected the Seedance JSON contract")
	}
	if !IsSeedance2NZVideoConfig(Config{BaseURL: "https://api.seedance.nz", Model: "seedance-2.0-fast-t2v"}) {
		t.Fatal("Seedance 2.0 Fast was not selected for the JSON contract")
	}
	if IsSeedance2NZVideoConfig(Config{BaseURL: "https://api.seedance.nz", Model: "seedance-2.5-standard-t2v"}) {
		t.Fatal("Seedance 2.5 must keep its existing adapter")
	}
}
