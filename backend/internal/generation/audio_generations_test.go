package generation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestAudioGenerationsProtocolSubmitsPollsAndDownloads(t *testing.T) {
	var polls atomic.Int32
	audio := []byte("ID3fixture-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fixture-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/audio/generations":
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["model"] != "mureka-v9-fixture" || body["prompt"] != "fixture prompt" || body["voice"] != "fixture-voice" || body["is_instrumental"] != true {
				t.Fatalf("unexpected submit body: %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"task_id": "task-1", "status": "queued"})
		case "/v1/audio/generations/task-1":
			if polls.Add(1) == 1 {
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": map[string]interface{}{"status": "processing"}})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"data": map[string]interface{}{"status": "SUCCESS", "result_url": serverURL(r) + "/media/audio.mp3"}})
		case "/media/audio.mp3":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audio)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := RunAudioTask(context.Background(), Input{
		Mode:     "audio",
		Prompt:   "fixture prompt",
		Config:   Config{BaseURL: server.URL, APIKey: "fixture-key", Model: "mureka-v9-fixture", InterfaceType: "async-audio", AudioVoice: "fixture-voice", AudioFormat: "mp3", AudioSpeed: "1"},
		Metadata: map[string]interface{}{"audioIsInstrumental": true},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if string(encoded) == "" || polls.Load() < 2 {
		t.Fatalf("unexpected result=%s polls=%d", encoded, polls.Load())
	}
}

func serverURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}
