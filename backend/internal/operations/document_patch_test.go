package operations

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/canvas"
)

type documentPatchDomain struct {
	unusedDomain
	got canvas.DocumentPatch
}

func (d *documentPatchDomain) PatchUserCanvasDocument(_ string, _ string, patch canvas.DocumentPatch) (canvas.DocumentPatchResult, error) {
	d.got = patch
	return canvas.DocumentPatchResult{
		Summary:            canvas.UserDataSummary{ID: "canvas", Title: "增量画布", Revision: 9},
		ServerAdvanced:     true,
		MediaPreserved:     true,
		SnapshotCaptured:   true,
		MergedFromRevision: 7,
		Document:           json.RawMessage(`{"id":"canvas","title":"增量画布","revision":9,"nodes":[],"connections":[]}`),
	}, nil
}

func TestOpCanvasDocumentPatchBuildsEntityDeltaAndReturnsMergedDocument(t *testing.T) {
	domain := &documentPatchDomain{}
	result, err := opCanvasDocumentPatch(&Context{UserID: "owner", Domain: domain}, json.RawMessage(`{
		"canvasId":"canvas",
		"baseRevision":7,
		"upsertNodes":[{"id":"n2","type":"text","title":"本地"}],
		"deleteNodeIds":["n1"],
		"expectedNodes":{"n1":{"id":"n1","title":"旧"},"n2":{"id":"n2","title":"旧"}},
		"fields":{"title":"新标题"},
		"expectedFields":{"title":"旧标题"},
		"forceHistorySnapshot":true
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if domain.got.BaseRevision != 7 || len(domain.got.UpsertNodes) != 1 || len(domain.got.DeleteNodeIDs) != 1 {
		t.Fatalf("unexpected patch: %+v", domain.got)
	}
	if !domain.got.ForceHistorySnapshot || domain.got.Fields["title"] != "新标题" {
		t.Fatalf("top-level delta not decoded: %+v", domain.got)
	}
	output := result.(map[string]any)
	if output["revision"] != int64(9) || output["serverAdvanced"] != true || output["mediaPreserved"] != true || output["snapshotCaptured"] != true {
		t.Fatalf("unexpected result: %+v", output)
	}
	if document, ok := output["document"].(map[string]any); !ok || document["title"] != "增量画布" {
		t.Fatalf("merged document missing: %+v", output)
	}
}
