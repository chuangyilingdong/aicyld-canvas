package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestFactsConvertsSourceDurationMillisecondsAsString(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"metadata": map[string]any{"sourceDurationMs": "5208"},
	})
	facts := Facts(&model.Task{Type: "canvas_video", Provider: "managed", Model: "Topaz-Upscale-LowPirce", InputJSON: string(raw)})
	if facts["sourceDurationSeconds"] != 5.208 {
		t.Fatalf("sourceDurationSeconds = %v, want 5.208", facts["sourceDurationSeconds"])
	}
}

func TestMainUserIDRemovesWorkspacePrefix(t *testing.T) {
	if got := mainUserID("sso_cmpz123"); got != "cmpz123" {
		t.Fatalf("main user id = %q", got)
	}
}

func TestSettleReturnsActualChargedPoints(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/canvas-billing/settle" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"settled","chargedPoints":3,"refundedPoints":0}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, secret: "test-secret", http: server.Client()}
	settlement, err := client.Settle(context.Background(), &model.Task{BillingHoldID: "hold-1"}, "succeeded", "done")
	if err != nil {
		t.Fatal(err)
	}
	if settlement == nil || settlement.Status != "settled" || settlement.ChargedPoints != 3 {
		t.Fatalf("settlement = %+v", settlement)
	}
}

func TestBillingQuoteKeepsZeroBalance(t *testing.T) {
	raw, err := json.Marshal(model.BillingQuote{Enabled: true, Points: 1, Balance: 0})
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	balance, ok := payload["balance"]
	if !ok || balance != float64(0) {
		t.Fatalf("zero balance must stay in the quote contract: %s", raw)
	}
}
