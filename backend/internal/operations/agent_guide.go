package operations

import (
	"encoding/json"

	"infinite-canvas/backend/internal/agentguide"
)

func registerAgentGuideOp(r *Registry) {
	r.Register(Op{ExternalOnly: true, ID: "agent.guide", Summary: "读取 AICYLD 画布外部 Agent 使用说明和内容哈希", ReadOnly: true, Scope: ScopeWorkspaceRead,
		Params:  json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{}}`),
		Handler: opAgentGuide})
}

func opAgentGuide(_ *Context, _ json.RawMessage) (any, error) {
	return agentguide.Load(), nil
}
