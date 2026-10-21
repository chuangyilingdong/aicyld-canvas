package canvas

import "testing"

func TestApplyGenerationBindMetadataClearsRetainedVideoPresentation(t *testing.T) {
	metadata := map[string]any{
		"content":                "/api/resources/old/file",
		"storageKey":             "resource:old",
		"assetId":                "asset-old",
		"previewContent":         "/api/resources/old-preview/file",
		"videoPreview":           map[string]any{"content": "/api/resources/old-preview/file", "storageKey": "resource:old-preview"},
		"naturalWidth":           float64(720),
		"naturalHeight":          float64(1280),
		"durationMs":             float64(9000),
		"hasAudio":               true,
		"bytes":                  float64(200),
		"mimeType":               "video/mp4",
		"outputParameterWarning": "old warning",
	}
	applyGenerationBindMetadata(metadata, TaskOutputBind{
		MediaType:  "video",
		AssetID:    "asset-new",
		StorageKey: "resource:new",
		Content:    "/api/resources/new/file",
		MimeType:   "video/mp4",
		Bytes:      100,
		Width:      1280,
		Height:     720,
	})
	for _, key := range []string{"previewContent", "videoPreview", "durationMs", "hasAudio", "outputParameterWarning"} {
		if _, exists := metadata[key]; exists {
			t.Fatalf("new video inherited old output %s: %#v", key, metadata[key])
		}
	}
	if nodeString(metadata, "content") != "/api/resources/new/file" || nodeString(metadata, "storageKey") != "resource:new" || nodeString(metadata, "assetId") != "asset-new" {
		t.Fatalf("new video did not replace retained media: %#v", metadata)
	}
}
