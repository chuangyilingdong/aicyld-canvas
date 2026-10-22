package billing

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestFactsExtractsVideoPriceDimensions(t *testing.T) {
	input := map[string]any{
		"mode": "video",
		"config": map[string]any{
			"providerModelKey":   "MiniMax-H3",
			"videoSeconds":       "15",
			"vquality":           "768P",
			"videoGenerateAudio": "false",
			"apiKey":             "must-not-leak",
		},
		"metadata": map[string]any{"source": "canvas"},
	}
	raw, _ := json.Marshal(input)
	facts := Facts(&model.Task{Type: "canvas_video", Operation: "image_to_video", Provider: "managed", Model: "logical-h3", InputJSON: string(raw)})
	if facts["modelKey"] != "MiniMax-H3" || facts["durationSeconds"] != 15 || facts["resolution"] != "768p" {
		t.Fatalf("unexpected facts: %+v", facts)
	}
	if _, leaked := facts["apiKey"]; leaked {
		t.Fatalf("facts leaked provider secret: %+v", facts)
	}
}

func TestBillableSkipsLocalExecutors(t *testing.T) {
	if Billable(&model.Task{Type: "canvas_video", Model: "MiniMax-H3", Provider: "local"}) {
		t.Fatal("local provider must not be billable")
	}
	if Billable(&model.Task{Type: "timeline_render", Model: "ffmpeg", Provider: "managed"}) {
		t.Fatal("timeline render must not be billable")
	}
	if !Billable(&model.Task{Type: "canvas_image", Model: "zhenzhen-image-g-v2.5-lowprice", Provider: "managed"}) {
		t.Fatal("managed image task should be billable")
	}
}

func TestFactsNormalizesNumericVideoResolution(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"config": map[string]any{"providerModelKey": "MiniMax-H3", "vquality": "1080", "videoSeconds": "15"},
	})
	facts := Facts(&model.Task{Type: "canvas_video", Provider: "managed", Model: "MiniMax-H3", InputJSON: string(raw)})
	if facts["resolution"] != "1080p" {
		t.Fatalf("resolution = %v, want 1080p", facts["resolution"])
	}
}

func TestMainUserIDRemovesWorkspacePrefix(t *testing.T) {
	if got := mainUserID("sso_cmpz123"); got != "cmpz123" {
		t.Fatalf("main user id = %q", got)
	}
}
