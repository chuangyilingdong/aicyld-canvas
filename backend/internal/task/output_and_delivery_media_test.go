package task

import (
	"encoding/json"
	"testing"
)

func TestPublicTaskInputJSONPreservesVideoSettlementFacts(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"mode": "video",
		"config": map[string]any{
			"model":              "seedance-2.0-fast",
			"providerModelKey":   "seedance-2.0-fast-t2v",
			"size":               "16:9",
			"vquality":           "480p",
			"videoSeconds":       "4",
			"videoGenerateAudio": "false",
			"count":              "1",
		},
	})
	var public map[string]any
	if err := json.Unmarshal([]byte(PublicTaskInputJSON(string(raw))), &public); err != nil {
		t.Fatal(err)
	}
	parameters, _ := public["videoParameters"].(map[string]any)
	for key, want := range map[string]any{
		"model": "seedance-2.0-fast", "vquality": "480p", "videoSeconds": "4", "videoGenerateAudio": "false", "count": "1",
	} {
		if parameters[key] != want {
			t.Fatalf("videoParameters[%s] = %#v, want %#v; all=%#v", key, parameters[key], want, parameters)
		}
	}
}

func TestPublicTaskInputJSONIsIdempotentForVideoParameters(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"mode": "video",
		"config": map[string]any{
			"model": "seedance-2.0-fast", "vquality": "480p", "videoSeconds": "4", "count": "1",
		},
	})
	first := PublicTaskInputJSON(string(raw))
	second := PublicTaskInputJSON(first)
	var got map[string]any
	if err := json.Unmarshal([]byte(second), &got); err != nil {
		t.Fatal(err)
	}
	parameters, _ := got["videoParameters"].(map[string]any)
	if parameters["model"] != "seedance-2.0-fast" || parameters["vquality"] != "480p" || parameters["videoSeconds"] != "4" || parameters["count"] != "1" {
		t.Fatalf("second sanitization lost video facts: %#v", parameters)
	}
}
