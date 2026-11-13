package app

import (
	"context"
	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/taskruntime"
)

const taskStageRequestNotSent = taskruntime.StageRequestNotSent

type taskTerminalCoordinator = taskruntime.Terminal
type taskTerminalRepository = taskruntime.TerminalRepository

type taskTerminalServiceAdapter struct{ service *Service }

func (a taskTerminalServiceAdapter) FinalizeTaskTextReplay(id string, status model.TaskStatus) error {
	return a.service.finalizeTaskTextReplay(id, status)
}
func (a taskTerminalServiceAdapter) Log(userID, taskID, level, message, payload string) error {
	return a.service.log(userID, taskID, level, message, payload)
}
func (a taskTerminalServiceAdapter) DeliverSucceededTask(task model.Task) error {
	return a.service.DeliverSucceededTask(task)
}
func (a taskTerminalServiceAdapter) Settle(ctx context.Context, task *model.Task, outcome string, reason string) (*billingclient.BillingSettlement, error) {
	return taskBillingAdapter{a.service.billing}.Settle(ctx, task, outcome, reason)
}

func (a taskTerminalServiceAdapter) Release(ctx context.Context, task *model.Task, reason string) (*billingclient.BillingSettlement, error) {
	return taskBillingAdapter{a.service.billing}.Release(ctx, task, reason)
}

func (a taskTerminalServiceAdapter) RegisterTaskOutputFromTask(task model.Task) error {
	return a.service.RegisterTaskOutputFromTask(task)
}

func newTaskTerminalCoordinator(s *Service) *taskTerminalCoordinator {
	adapter := taskTerminalServiceAdapter{s}
	return taskruntime.NewTerminal(taskruntime.TerminalDependencies{
		Repository: s.repo, Replay: adapter, Billing: adapter, Logger: adapter, Outputs: adapter,
		UserFacingMessage: s.UserFacingErrorMessage, CaptureFailure: captureTaskFailureDiagnostics, LogFailedAttempt: s.ensureFailedProviderAttemptLogged,
	})
}
func (s *Service) terminalCoordinator() *taskTerminalCoordinator {
	if s.taskTerminalCoordinator != nil {
		return s.taskTerminalCoordinator
	}
	return newTaskTerminalCoordinator(s)
}
