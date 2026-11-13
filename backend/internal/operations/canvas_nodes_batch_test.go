package operations

import (
	"encoding/json"
	"reflect"
	"testing"

	"infinite-canvas/backend/internal/canvas"
)

type batchCanvasProbe struct {
	unusedDomain
	doc      json.RawMessage
	commits  int
	lastDoc  json.RawMessage
	lastBase int64
}

func (p *batchCanvasProbe) UserCanvasProject(_ string, _ string) (json.RawMessage, error) {
	return p.doc, nil
}

func (p *batchCanvasProbe) CommitUserCanvasDocument(_ string, _ string, expected int64, document json.RawMessage) (canvas.UserDataSummary, json.RawMessage, error) {
	p.commits++
	p.lastBase = expected
	p.lastDoc = append(json.RawMessage(nil), document...)
	var doc map[string]any
	if err := json.Unmarshal(document, &doc); err != nil {
		return canvas.UserDataSummary{}, nil, err
	}
	doc["revision"] = float64(expected + 1)
	p.doc, _ = json.Marshal(doc)
	return canvas.UserDataSummary{Revision: expected + 1}, document, nil
}

func TestCanvasNodesGetDeduplicatesIDsAndReportsMissing(t *testing.T) {
	probe := &batchCanvasProbe{doc: json.RawMessage(`{"revision":4,"nodes":[{"id":"n1","type":"image","title":"一"},{"id":"n2","type":"video","title":"二"}]}`)}
	raw, _ := json.Marshal(map[string]any{"canvasId": "c1", "nodeIds": []string{"n2", "n1", "n2", "missing"}})
	value, err := opCanvasNodesGet(&Context{UserID: "owner", Domain: probe}, raw)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	if result["revision"] != int64(4) || len(result["nodes"].([]any)) != 2 {
		t.Fatalf("unexpected nodes result: %#v", result)
	}
	if !reflect.DeepEqual(result["missingNodeIds"], []string{"missing"}) {
		t.Fatalf("missing IDs = %#v", result["missingNodeIds"])
	}
}

func TestCanvasNodesConfigureCommitsOnce(t *testing.T) {
	probe := &batchCanvasProbe{doc: json.RawMessage(`{"revision":5,"nodes":[{"id":"img","type":"image","metadata":{}},{"id":"vid","type":"video","metadata":{}}]}`)}
	raw, _ := json.Marshal(map[string]any{
		"canvasId": "c1", "expectedRevision": 5,
		"nodes": []map[string]any{
			{"nodeId": "img", "kind": "image", "patch": map[string]any{"prompt": "雨夜街道", "count": 2}},
			{"nodeId": "vid", "kind": "video", "patch": map[string]any{"prompt": "镜头推进", "seconds": "5"}},
		},
	})
	value, err := opCanvasNodesConfigure(&Context{UserID: "owner", Domain: probe}, raw)
	if err != nil {
		t.Fatal(err)
	}
	if probe.commits != 1 || probe.lastBase != 5 {
		t.Fatalf("commits=%d base=%d", probe.commits, probe.lastBase)
	}
	result := value.(map[string]any)
	if result["revision"] != int64(6) {
		t.Fatalf("revision = %#v", result["revision"])
	}
	var committed map[string]any
	if err := json.Unmarshal(probe.lastDoc, &committed); err != nil {
		t.Fatal(err)
	}
	img := findDocNode(committed, "img")
	if img["metadata"].(map[string]any)["composerContent"] != "雨夜街道" {
		t.Fatalf("image prompt not applied: %#v", img)
	}
}

func TestCanvasNodesConfigureRejectsWholeBatchBeforeCommit(t *testing.T) {
	probe := &batchCanvasProbe{doc: json.RawMessage(`{"revision":3,"nodes":[{"id":"img","type":"image","metadata":{"composerContent":"old"}}]}`)}
	raw, _ := json.Marshal(map[string]any{
		"canvasId": "c1", "expectedRevision": 3,
		"nodes": []map[string]any{
			{"nodeId": "img", "kind": "image", "patch": map[string]any{"prompt": "new"}},
			{"nodeId": "missing", "kind": "video", "patch": map[string]any{"prompt": "next"}},
		},
	})
	_, err := opCanvasNodesConfigure(&Context{UserID: "owner", Domain: probe}, raw)
	opErr := AsError(err)
	if opErr.Reason != "node_not_found" || probe.commits != 0 {
		t.Fatalf("reason=%s commits=%d", opErr.Reason, probe.commits)
	}
	if opErr.Details["index"] != 1 || opErr.Details["nodeId"] != "missing" {
		t.Fatalf("missing error location: %#v", opErr.Details)
	}
	var unchanged map[string]any
	_ = json.Unmarshal(probe.doc, &unchanged)
	if findDocNode(unchanged, "img")["metadata"].(map[string]any)["composerContent"] != "old" {
		t.Fatal("failed batch changed the in-memory canvas")
	}
}
