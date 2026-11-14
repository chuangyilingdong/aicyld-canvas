package smartfilm

import "testing"

func TestSplitModelOption(t *testing.T) {
	channel, model := SplitModelOption("channel-1::text-model")
	if channel != "channel-1" || model != "text-model" {
		t.Fatalf("split = %q/%q", channel, model)
	}
	channel, model = SplitModelOption("text-only")
	if channel != "" || model != "text-only" {
		t.Fatalf("plain split = %q/%q", channel, model)
	}
}

func TestDecodeAssetResultJSON(t *testing.T) {
	payload, err := DecodeJSONObject("```json\n{\"characters\":[],\"scenes\":[{\"name\":\"车站\"}],\"props\":[]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(JSONArray(payload["scenes"])) != 1 || JSONString(JSONMap(JSONArray(payload["scenes"])[0])["name"]) != "车站" {
		t.Fatalf("payload = %+v", payload)
	}
}
