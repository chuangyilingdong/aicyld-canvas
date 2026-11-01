package billing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
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
	facts := Facts(&TaskSnapshot{Type: "canvas_video", Operation: "image_to_video", Provider: "managed", Model: "logical-h3", InputJSON: string(raw)})
	if facts["modelKey"] != "MiniMax-H3" || facts["durationSeconds"] != 15 || facts["resolution"] != "768p" {
		t.Fatalf("unexpected facts: %+v", facts)
	}
	if _, leaked := facts["apiKey"]; leaked {
		t.Fatalf("facts leaked provider secret: %+v", facts)
	}
}

func TestBillableSkipsLocalExecutors(t *testing.T) {
	if Billable(&TaskSnapshot{Type: "canvas_video", Model: "MiniMax-H3", Provider: "local"}) {
		t.Fatal("local provider must not be billable")
	}
	if Billable(&TaskSnapshot{Type: "timeline_render", Model: "ffmpeg", Provider: "managed"}) {
		t.Fatal("timeline render must not be billable")
	}
	if !Billable(&TaskSnapshot{Type: "canvas_image", Model: "zhenzhen-image-g-v2.5-lowprice", Provider: "managed"}) {
		t.Fatal("managed image task should be billable")
	}
}

func TestFactsNormalizesNumericVideoResolution(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"config": map[string]any{"providerModelKey": "MiniMax-H3", "vquality": "1080", "videoSeconds": "15"},
	})
	facts := Facts(&TaskSnapshot{Type: "canvas_video", Provider: "managed", Model: "MiniMax-H3", InputJSON: string(raw)})
	if facts["resolution"] != "1080p" {
		t.Fatalf("resolution = %v, want 1080p", facts["resolution"])
	}
}

func TestFactsReadsPersistedPublicVideoParametersAfterCompletion(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"mode": "video",
		"videoParameters": map[string]any{
			"model":              "MiniMax-H3",
			"vquality":           "480p",
			"videoSeconds":       "4",
			"videoGenerateAudio": "false",
			"count":              "1",
		},
	})
	facts := Facts(&TaskSnapshot{Type: "canvas_video", Operation: "text_to_video", Provider: "managed", InputJSON: string(raw)})
	if facts["modelKey"] != "MiniMax-H3" || facts["durationSeconds"] != 4 || facts["resolution"] != "480p" || facts["outputCount"] != 1 || facts["generateAudio"] != false {
		t.Fatalf("unexpected persisted facts: %+v", facts)
	}
}

func TestFactsConvertsSourceDurationMillisecondsAsString(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"metadata": map[string]any{"sourceDurationMs": "5208"},
	})
	facts := Facts(&TaskSnapshot{Type: "canvas_video", Provider: "managed", Model: "Topaz-Upscale-LowPirce", InputJSON: string(raw)})
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
	settlement, err := client.Settle(context.Background(), &TaskSnapshot{BillingHoldID: "hold-1"}, "succeeded", "done")
	if err != nil {
		t.Fatal(err)
	}
	if settlement == nil || settlement.Status != "settled" || settlement.ChargedPoints != 3 {
		t.Fatalf("settlement = %+v", settlement)
	}
}

func TestBillingQuoteKeepsZeroBalance(t *testing.T) {
	raw, err := json.Marshal(BillingQuote{Enabled: true, Points: 1, Balance: 0})
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

func TestBillingBalanceUsesMainUserID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/canvas-billing/balance" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["userId"] != "cmpz123" {
			t.Fatalf("userId = %v", body["userId"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true,"balance":16}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, secret: "test-secret", http: server.Client()}
	balance, err := client.Balance(context.Background(), "sso_cmpz123")
	if err != nil {
		t.Fatal(err)
	}
	if balance == nil || !balance.Enabled || balance.Balance != 16 {
		t.Fatalf("balance = %+v", balance)
	}
}

func TestReserveUsesStableRouteRunIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/internal/canvas-billing/reserve" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["taskId"] != "task-1" || body["idempotencyKey"] != "task-1:2" || body["userId"] != "cmpz123" {
			t.Fatalf("unexpected reserve body: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true,"holdId":"hold-1","points":3,"balance":9,"status":"reserved"}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, secret: "test-secret", http: server.Client()}
	reservation, err := client.Reserve(context.Background(), "sso_cmpz123", &TaskSnapshot{
		ID: "task-1", RouteRun: 2, Type: "canvas_image", Provider: "managed", Model: "image-model",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reservation == nil || reservation.HoldID != "hold-1" || reservation.Points != 3 {
		t.Fatalf("reservation = %+v", reservation)
	}
}

func TestAPIErrorClassification(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"code":"POINTS_INSUFFICIENT","error":"积分不足"}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, secret: "test-secret", http: server.Client()}
	_, err := client.Balance(context.Background(), "sso_cmpz123")
	if !IsInsufficient(err) {
		t.Fatalf("error = %v, want insufficient", err)
	}
	if IsRuleMissing(err) {
		t.Fatalf("insufficient error misclassified as missing rule: %v", err)
	}
}

func TestReservePrefersClientOperationIdempotencyKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["idempotencyKey"] != "op-1:2" {
			t.Fatalf("idempotencyKey = %v", body["idempotencyKey"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"enabled":true,"holdId":"hold-1","points":3,"balance":9,"status":"reserved"}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, secret: "test-secret", http: server.Client()}
	_, err := client.Reserve(context.Background(), "user", &TaskSnapshot{
		ID: "task-1", ClientOperationID: "op-1", RouteRun: 2, Type: "canvas_image", Provider: "managed", Model: "image-model",
	})
	if err != nil {
		t.Fatal(err)
	}
}
