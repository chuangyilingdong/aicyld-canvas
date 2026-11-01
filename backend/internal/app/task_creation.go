package app

import (
	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
	localtask "infinite-canvas/backend/internal/task"
)

const retiredAgentBoundaryMessage = localtask.RetiredAgentBoundaryMessage

// CreateTask 把应用层请求交给任务域。模型目录、密钥和配额仍通过 typed ports 留在 app。
func (s *Service) CreateTask(userID string, req CreateTaskRequest) (*model.Task, error) {
	return s.taskDomain().CreateTask(userID, toTaskCreateRequest(req))
}

// QuoteTask 返回主站积分报价，不创建任务、不提交上游、不预扣。
func (s *Service) QuoteTask(userID string, req CreateTaskRequest) (*billing.BillingQuote, error) {
	return s.taskDomain().QuoteTask(userID, toTaskCreateRequest(req))
}

// QuoteLocalTask 接受上游任务域的 CreateRequest，供 HTTP 路由直接报价。
func (s *Service) QuoteLocalTask(userID string, req localtask.CreateRequest) (*billing.BillingQuote, error) {
	return s.taskDomain().QuoteTask(userID, req)
}

func (s *Service) requireCustomChannelsForTaskInput(input map[string]any) error {
	if !taskInputUsesCustomChannel(input) {
		return nil
	}
	return s.RequireFeature(FeatureCustomChannels)
}

func (s *Service) taskSelectLookup() modelcatalog.TaskSelectLookup {
	lookup := modelcatalog.TaskSelectLookup{}
	if s == nil {
		return lookup
	}
	if s.repo != nil {
		lookup.SystemChannel = s.repo.SystemChannel
		lookup.ChannelModelByKey = s.repo.ChannelModelByKey
	}
	lookup.ResolveLogical = s.ResolveLogicalModel
	return lookup
}

func (s *Service) resolveTaskModelSelection(input map[string]any, logicalModelID string, taskType string, operation string, frontendEnabled bool) (*RoutedModel, map[string]any, error) {
	result, err := modelcatalog.SelectTaskModel(modelcatalog.TaskSelectRequest{
		Input:           input,
		LogicalModelID:  logicalModelID,
		Type:            taskType,
		Operation:       operation,
		FrontendEnabled: frontendEnabled,
	}, s.taskSelectLookup())
	if err != nil {
		return nil, input, err
	}
	return result.Routed, result.Input, nil
}

func (s *Service) resolveSystemChannelModelSelection(input map[string]any, taskType string, operation string) (map[string]any, error) {
	return modelcatalog.ResolveSystemChannelModelSelection(input, taskType, operation, s.taskSelectLookup())
}

func taskInputUsesCustomChannel(input map[string]any) bool {
	return modelcatalog.TaskInputUsesCustomChannel(input)
}

func taskInputUsesSystemChannel(input map[string]any) bool {
	return modelcatalog.TaskInputUsesSystemChannel(input)
}

func taskInputUsesWorkflowProvider(input map[string]any) bool {
	return modelcatalog.TaskInputUsesWorkflowProvider(input)
}
