package operations

import (
	"encoding/json"
	"strings"
	"time"
)

func registerCanvasNodesBatchOps(r *Registry) {
	r.Register(Op{ExternalOnly: true, ID: "canvas.nodes.get", Summary: "批量读取指定画布节点；单个节点缺失不会拒绝整批", ReadOnly: true, Scope: ScopeCanvas,
		Params: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"canvasId":{"type":"string"},"nodeIds":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":50}},"required":["canvasId","nodeIds"]}`),
		Handler: opCanvasNodesGet})

	patchProperties := canvasNodeConfigurePatchProperties()
	params, _ := json.Marshal(map[string]any{
		"type": "object", "additionalProperties": false,
		"properties": map[string]any{
			"canvasId":         map[string]any{"type": "string"},
			"expectedRevision": map[string]any{"type": "integer", "minimum": 1},
			"nodes": map[string]any{
				"type": "array", "minItems": 1, "maxItems": 20,
				"items": map[string]any{
					"type": "object", "additionalProperties": false,
					"properties": map[string]any{
						"nodeId": map[string]any{"type": "string"},
						"kind":   map[string]any{"type": "string", "enum": []string{"image", "video", "audio"}},
						"patch": map[string]any{"type": "object", "minProperties": 1, "additionalProperties": false, "properties": patchProperties},
					},
					"required": []string{"nodeId", "kind", "patch"},
				},
			},
		},
		"required": []string{"canvasId", "expectedRevision", "nodes"},
	})
	r.Register(Op{ExternalOnly: true, ReplaySafe: true, ID: "canvas.nodes.configure", Summary: "批量设置媒体节点提示词草稿与生成参数；全部成功后只推进一次画布版本", Scope: ScopeCanvas,
		Params: params, Handler: opCanvasNodesConfigure})
}

func opCanvasNodesGet(ctx *Context, raw json.RawMessage) (any, error) {
	var args struct {
		CanvasID string   `json:"canvasId"`
		NodeIDs  []string `json:"nodeIds"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	canvasID := strings.TrimSpace(args.CanvasID)
	if canvasID == "" {
		return nil, InvalidArg("invalid_params", "canvasId 必填")
	}
	nodeIDs, err := uniqueCanvasNodeIDs(args.NodeIDs, 50)
	if err != nil {
		return nil, err
	}
	canvasRaw, err := ctx.Domain.UserCanvasProject(ctx.UserID, canvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(canvasRaw, &doc); err != nil {
		return nil, AsError(err)
	}
	nodes := make([]any, 0, len(nodeIDs))
	missing := make([]string, 0)
	for _, nodeID := range nodeIDs {
		node := findDocNode(doc, nodeID)
		if node == nil {
			missing = append(missing, nodeID)
			continue
		}
		nodes = append(nodes, sanitizeForClient(node))
	}
	return map[string]any{
		"canvasId": canvasID, "revision": canvasRevision(doc),
		"nodes": nodes, "missingNodeIds": missing,
	}, nil
}

func opCanvasNodesConfigure(ctx *Context, raw json.RawMessage) (any, error) {
	type configureItem struct {
		NodeID string                     `json:"nodeId"`
		Kind   string                     `json:"kind"`
		Patch  map[string]json.RawMessage `json:"patch"`
	}
	var args struct {
		CanvasID         string          `json:"canvasId"`
		ExpectedRevision int64           `json:"expectedRevision"`
		Nodes            []configureItem `json:"nodes"`
	}
	if err := decodeParams(raw, &args); err != nil {
		return nil, err
	}
	canvasID := strings.TrimSpace(args.CanvasID)
	if canvasID == "" || args.ExpectedRevision <= 0 || len(args.Nodes) == 0 || len(args.Nodes) > 20 {
		return nil, InvalidArg("invalid_params", "需要画布、当前版本和 1–20 个节点配置")
	}
	canvasRaw, err := ctx.Domain.UserCanvasProject(ctx.UserID, canvasID)
	if err != nil {
		return nil, mapDomainError(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(canvasRaw, &doc); err != nil {
		return nil, AsError(err)
	}
	if revision := canvasRevision(doc); revision != args.ExpectedRevision {
		return nil, Conflict("revision_conflict", "画布已变化，请重新读取", map[string]any{"currentRevision": revision})
	}

	seen := make(map[string]bool, len(args.Nodes))
	configuredNodeIDs := make([]string, 0, len(args.Nodes))
	for index, item := range args.Nodes {
		nodeID := strings.TrimSpace(item.NodeID)
		if nodeID == "" || len(item.Patch) == 0 {
			return nil, batchNodeError(InvalidArg("invalid_params", "每个节点都需要 nodeId 和非空 patch"), index, nodeID)
		}
		if seen[nodeID] {
			return nil, batchNodeError(InvalidArg("duplicate_node_id", "同一批次不能重复配置同一个节点"), index, nodeID)
		}
		seen[nodeID] = true
		if item.Kind != "image" && item.Kind != "video" && item.Kind != "audio" {
			return nil, batchNodeError(InvalidArg("unsupported_node_kind", "仅媒体生成节点支持参数配置"), index, nodeID)
		}
		node := findDocNode(doc, nodeID)
		if node == nil {
			return nil, batchNodeError(NotFound("node_not_found", "节点不在当前画布"), index, nodeID)
		}
		if node["type"] != item.Kind {
			return nil, batchNodeError(InvalidArg("node_kind_mismatch", "参数类型与目标节点不一致"), index, nodeID)
		}
		if _, err := applyGenerationDraftToNode(ctx, node, item.Kind, item.Patch); err != nil {
			return nil, batchNodeError(err, index, nodeID)
		}
		node["updatedAt"] = time.Now().UTC().Format(time.RFC3339)
		configuredNodeIDs = append(configuredNodeIDs, nodeID)
	}

	encoded, err := json.Marshal(doc)
	if err != nil {
		return nil, AsError(err)
	}
	if _, _, err := ctx.Domain.CommitUserCanvasDocument(ctx.UserID, canvasID, args.ExpectedRevision, encoded); err != nil {
		return nil, mapDomainError(err)
	}
	return canvasWriteResult(ctx, canvasID, func(after map[string]any) map[string]any {
		nodes := make([]any, 0, len(configuredNodeIDs))
		for _, nodeID := range configuredNodeIDs {
			if node := findDocNode(after, nodeID); node != nil {
				nodes = append(nodes, sanitizeForClient(node))
			}
		}
		return map[string]any{
			"canvasId": canvasID, "configuredNodeIds": configuredNodeIDs,
			"nodes": nodes, "draftConfigured": true,
		}
	})
}

func uniqueCanvasNodeIDs(values []string, limit int) ([]string, error) {
	if len(values) == 0 || len(values) > limit {
		return nil, InvalidArg("invalid_params", "nodeIds 数量必须在 1–50 之间")
	}
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value)
		if id == "" || len(id) > 80 {
			return nil, InvalidArg("invalid_params", "nodeIds 包含无效节点 ID")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result, nil
}

func batchNodeError(err error, index int, nodeID string) error {
	opErr := AsError(err)
	if opErr.Details == nil {
		opErr.Details = map[string]any{}
	}
	opErr.Details["index"] = index
	if strings.TrimSpace(nodeID) != "" {
		opErr.Details["nodeId"] = strings.TrimSpace(nodeID)
	}
	return opErr
}
