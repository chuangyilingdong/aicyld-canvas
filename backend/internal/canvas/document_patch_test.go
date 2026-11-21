package canvas

import (
	"encoding/json"
	"strings"
	"testing"
)

func decodeCanvasDocument(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

func canvasNodeByID(t *testing.T, doc map[string]any, id string) map[string]any {
	t.Helper()
	for _, raw := range canvasDocNodes(doc) {
		node, _ := raw.(map[string]any)
		if nodeString(node, "id") == id {
			return node
		}
	}
	t.Fatalf("node %s not found", id)
	return nil
}

func TestPatchUserCanvasDocumentMergesDisjointStaleEdits(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas","revision":0,"title":"并发画布",
		"nodes":[
			{"id":"a","type":"text","title":"A","content":"a1"},
			{"id":"b","type":"text","title":"B","content":"b1"}
		],
		"connections":[{"id":"edge-ab","fromNodeId":"a","toNodeId":"b"}],
		"chatSessions":[]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	updated, err := svc.UpdateUserCanvasNodeFields("owner", "canvas", "a", map[string]any{"title": "A 服务端"}, created.Revision)
	if err != nil {
		t.Fatal(err)
	}

	result, err := svc.PatchUserCanvasDocument("owner", "canvas", DocumentPatch{
		BaseRevision:  created.Revision,
		UpsertNodes: []map[string]any{{
			"id": "b", "type": "text", "title": "B 本地", "content": "b2",
		}},
		ExpectedNodes: map[string]map[string]any{
			"b": {"id": "b", "type": "text", "title": "B", "content": "b1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.Revision != updated.Revision+1 {
		t.Fatalf("revision=%d want=%d", result.Summary.Revision, updated.Revision+1)
	}
	if !result.ServerAdvanced {
		t.Fatal("stale baseRevision should report serverAdvanced")
	}
	doc := decodeCanvasDocument(t, result.Document)
	if got := nodeString(canvasNodeByID(t, doc, "a"), "title"); got != "A 服务端" {
		t.Fatalf("server node A overwritten: %q", got)
	}
	if got := nodeString(canvasNodeByID(t, doc, "b"), "title"); got != "B 本地" {
		t.Fatalf("local node B not merged: %q", got)
	}
	if edges, _ := doc["connections"].([]any); len(edges) != 1 {
		t.Fatalf("untouched connection count=%d", len(edges))
	}
}

func TestPatchUserCanvasDocumentPreservesBoundOutputFromStaleOverlay(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas","revision":0,"title":"生成画布",
		"nodes":[{"id":"img","type":"image","title":"旧标题","position":{"x":10,"y":20},"metadata":{
			"taskId":"task-1","taskStatus":"succeeded","status":"success",
			"storyboard":{"rows":[{"id":"shot-1"}]}
		}}],
		"connections":[],"chatSessions":[]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.PatchUserCanvasDocument("owner", "canvas", DocumentPatch{
		BaseRevision: created.Revision,
		UpsertNodes: []map[string]any{{
			"id": "img", "type": "image", "title": "用户改名", "position": map[string]any{"x": 40, "y": 50},
			"metadata": map[string]any{
				"taskId": "task-1", "taskStatus": "running", "status": "loading",
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.MediaPreserved {
		t.Fatal("bound server media should be preserved")
	}
	node := canvasNodeByID(t, decodeCanvasDocument(t, result.Document), "img")
	if got := nodeString(node, "title"); got != "用户改名" {
		t.Fatalf("user title lost: %q", got)
	}
	meta, _ := node["metadata"].(map[string]any)
	if _, ok := meta["storyboard"].(map[string]any); !ok || nodeString(meta, "status") != "success" {
		t.Fatalf("bound output lost: %+v", meta)
	}
}

func TestPatchUserCanvasDocumentDeletesNodeAndDanglingEdges(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas","revision":0,"title":"删除画布",
		"nodes":[
			{"id":"a","type":"text","title":"A"},
			{"id":"b","type":"text","title":"B"}
		],
		"connections":[{"id":"edge-ab","fromNodeId":"a","toNodeId":"b"}],
		"chatSessions":[]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	result, err := svc.PatchUserCanvasDocument("owner", "canvas", DocumentPatch{
		BaseRevision:  created.Revision,
		DeleteNodeIDs: []string{"a"},
		ExpectedNodes: map[string]map[string]any{
			"a": {"id": "a", "type": "text", "title": "A"},
		},
		ExpectedConnections: map[string]map[string]any{
			"edge-ab": {"id": "edge-ab", "fromNodeId": "a", "toNodeId": "b"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	doc := decodeCanvasDocument(t, result.Document)
	if nodes, _ := doc["nodes"].([]any); len(nodes) != 1 {
		t.Fatalf("nodes=%d want=1", len(nodes))
	}
	if edges, _ := doc["connections"].([]any); len(edges) != 0 {
		t.Fatalf("dangling edges=%d want=0", len(edges))
	}
}

func TestPatchUserCanvasDocumentSameEntityOverlapCapturesHistoryWithout409(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	created, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{
		"id":"canvas","revision":0,"title":"冲突画布",
		"nodes":[{"id":"a","type":"text","title":"初始","content":"v1"}],
		"connections":[],"chatSessions":[]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateUserCanvasNodeFields("owner", "canvas", "a", map[string]any{"title": "服务端"}, created.Revision); err != nil {
		t.Fatal(err)
	}
	result, err := svc.PatchUserCanvasDocument("owner", "canvas", DocumentPatch{
		BaseRevision: created.Revision,
		UpsertNodes: []map[string]any{{
			"id": "a", "type": "text", "title": "本地", "content": "v2",
		}},
		ExpectedNodes: map[string]map[string]any{
			"a": {"id": "a", "type": "text", "title": "初始", "content": "v1"},
		},
	})
	if err != nil {
		t.Fatalf("overlapping edit should merge with history, got %v", err)
	}
	if !result.SnapshotCaptured {
		t.Fatal("same-entity overlap should capture a recoverable history snapshot")
	}
	node := canvasNodeByID(t, decodeCanvasDocument(t, result.Document), "a")
	if got := nodeString(node, "title"); got != "本地" {
		t.Fatalf("local edit should win after merge, got %q", got)
	}
	history, err := svc.CanvasHistory("owner", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if len(history.Snapshots) == 0 {
		t.Fatal("history snapshot was not persisted")
	}
	if !strings.Contains(history.Snapshots[0].Reason, "before_merge") {
		t.Fatalf("snapshot reason=%q", history.Snapshots[0].Reason)
	}
}
