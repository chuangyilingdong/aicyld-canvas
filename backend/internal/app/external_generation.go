package app

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/operations"
	localtask "infinite-canvas/backend/internal/task"
)

// The operation registry authenticates external clients and commits admission,
// canvas receipts and operation replay together. No synthetic assistant turn is needed.
func (s *operationSession) SubmitExternalGeneration(userID, operationID, canvasID string, targets []operations.GenerationTarget) (any, error) {
	raw, err := s.canvas.UserCanvasProject(userID, canvasID)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	wanted := map[string]bool{}
	for _, target := range targets {
		wanted[target.NodeID] = true
	}
	for _, value := range doc["nodes"].([]any) {
		node, _ := value.(map[string]any)
		if !wanted[stringValue(node["id"])] {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		// A changed operation key is not evidence that an earlier uncertain
		// generation may be purchased again. Existing tasks keep their own retry path.
		if stringValue(meta["taskId"]) != "" || stringValue(meta["taskClientOperationId"]) != "" || stringValue(meta["generationSubmissionState"]) != "" || meta["status"] == "loading" {
			return nil, operations.PreconditionFailed("generation_task_exists", "节点已关联生成任务，请先查询原任务；需要另做一份时请新建节点", map[string]any{"nodeId": node["id"], "taskId": meta["taskId"]})
		}
	}
	// Namespace task keys separately from internal proposal IDs and caller-chosen strings.
	plan := operations.GenerationAuthorization{ProposalID: fmt.Sprintf("external-%x", sha256.Sum256([]byte(operationID))), Targets: targets}
	quote, err := s.quoteExternalGeneration(userID, canvasID, plan, targets)
	if err != nil {
		return nil, err
	}
	result, err := s.admitProductionTargets(userID, canvasID, plan, targets)
	if err != nil {
		return nil, err
	}
	if resultMap, ok := result.(map[string]any); ok {
		resultMap["estimatedCny"] = quote.EstimatedCNY
		resultMap["todayEstimatedCny"] = quote.TodayEstimatedCNY
	}
	return result, nil
}

type externalGenerationQuote struct {
	EstimatedCNY      float64
	TodayEstimatedCNY float64
}

func (s *operationSession) quoteExternalGeneration(userID, canvasID string, plan operations.GenerationAuthorization, targets []operations.GenerationTarget) (*externalGenerationQuote, error) {
	cfg := operations.GetExternalGenerationGuardrail(s.tx, userID)
	if cfg.Mode == operations.ExternalGuardrailModePropose {
		return nil, operations.EvaluateExternalGenerationGuardrail(cfg, 0, true, 0)
	}
	raw, err := s.canvas.UserCanvasProject(userID, canvasID)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	nodes := map[string]map[string]any{}
	for _, value := range doc["nodes"].([]any) {
		node, _ := value.(map[string]any)
		nodes[stringValue(node["id"])] = node
	}
	domain, err := s.productionTaskDomain()
	if err != nil {
		return nil, err
	}
	total := 0.0
	priceKnown := true
	for _, target := range targets {
		input, err := s.productionTaskInput(userID, target, nodes)
		if err != nil {
			return nil, err
		}
		meta := input["metadata"].(map[string]any)
		meta["clientOperationId"] = productionTaskKey(plan, target.NodeID)
		meta["assistantProductionTargetHash"] = operations.ProductionTargetHash(target)
		quote, err := domain.QuoteTask(userID, localtask.CreateRequest{ProjectID: canvasID, Type: "canvas_" + target.Kind, Prompt: target.Prompt, Input: input})
		if err != nil {
			return nil, operations.PreconditionFailed("external_budget_price_unknown", "外部 Agent 本次生成无法取得 BeefAPI 固定报价，已按资金安全策略阻止提交", map[string]any{"nodeId": target.NodeID, "cause": err.Error()})
		}
		if (quote == nil || !quote.Enabled) && !s.service.IsLocalMode() {
			priceKnown = false
			continue
		}
		amount, known := billingQuoteCostCNY(quote)
		if quote != nil && quote.Enabled && !known {
			priceKnown = false
			continue
		}
		total += amount
	}
	total = math.Round(total*10000) / 10000
	now := time.Now()
	todaySpent := operations.TodayExternalEstimatedSpendCNY(s.tx, userID, now)
	if err := operations.EvaluateExternalGenerationGuardrail(cfg, total, priceKnown, todaySpent); err != nil {
		return nil, err
	}
	todayTotal, err := operations.ReserveExternalEstimatedSpend(s.tx, userID, total, cfg.DailyBudgetCNY, now)
	if err != nil {
		return nil, err
	}
	return &externalGenerationQuote{EstimatedCNY: total, TodayEstimatedCNY: todayTotal}, nil
}

func billingQuoteCostCNY(quote *billing.BillingQuote) (float64, bool) {
	if quote == nil || !quote.Enabled {
		return 0, true
	}
	return billingQuoteAmount(quote.Enabled, quote.Points, quote.EstimatedCostCNY, quote.PointValueYuan)
}

func (s *operationSession) productionTaskDomain() (*localtask.Service, error) {
	policy, err := s.service.runtimePolicyWithRepo(s.repo)
	if err != nil {
		return nil, err
	}
	adapter := operationRenderDependencies{s: s, policy: policy}
	deps := s.service.taskDependencies()
	deps.Projects = adapter
	deps.Policy = adapter
	deps.Persist = adapter
	deps.Present = operationRenderPresenter{}
	deps.Logs = nil
	deps.Activity = nil
	return localtask.NewService(localtask.NewStore(s.repo), deps), nil
}

func billingQuoteAmount(quoteEnabled bool, points int, estimatedCostCNY, pointValueYuan float64) (float64, bool) {
	if !quoteEnabled {
		return 0, true
	}
	if estimatedCostCNY > 0 {
		return estimatedCostCNY, true
	}
	if points == 0 {
		return 0, true
	}
	if pointValueYuan > 0 {
		return math.Round(float64(points)*pointValueYuan*10000) / 10000, true
	}
	return 0, false
}

func (s *operationSession) ExternalGenerationGuardrailForUser(userID string) operations.ExternalGenerationGuardrail {
	return operations.GetExternalGenerationGuardrail(s.tx, userID)
}
