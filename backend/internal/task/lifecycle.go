package task

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func (s *Service) Retry(userID, id string) (*model.Task, error) {
	if s.deps.Runtime == nil || s.deps.Images == nil || s.deps.Failures == nil || s.deps.Secrets == nil || s.deps.Catalog == nil || s.deps.Media == nil || s.deps.Policy == nil || s.deps.Projects == nil || s.deps.Present == nil {
		return nil, unavailable()
	}
	if s.deps.Runtime.IsDraining() {
		return nil, drainError(DrainRetryMessage)
	}
	if s.store == nil {
		return nil, kernel.WrapAppError(kernel.CodeInternal, "任务服务不可用", errStoreRequired)
	}
	task, err := s.store.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.CreationSubmissionID != nil {
		return nil, kernel.NewAppError(kernel.CodeConflict, CreationRetryConflictMessage)
	}
	if RetiredAgentTask(task) {
		return nil, kernel.BadAuthRequest(RetiredAgentBoundaryMessage)
	}
	if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
		return nil, errors.New(RetryOnlyFailedOrCancelled)
	}
	if err := s.deps.Images.ValidateRetry(task); err != nil {
		return nil, err
	}
	if task.ProviderCancelStatus == model.ProviderCancelStatusRequested {
		return nil, kernel.BadAuthRequest(CancellationPendingRetryMessage)
	}
	if s.deps.Failures.IsModeration(task.Error) {
		return nil, kernel.BadAuthRequest(ContentModerationRetryMessage)
	}
	if s.deps.Failures.BlocksRetry(task.Error, task.Stage) {
		category := s.deps.Failures.Category(task.Error, task.Stage)
		if task.Stage == "submission_unknown" || category == generation.CategorySubmissionUncertain {
			return nil, kernel.BadAuthRequest(SubmissionUncertainRetryMessage)
		}
		if category == generation.CategoryDownloadFailed {
			return nil, kernel.BadAuthRequest(DownloadFailureRetryMessage)
		}
		return nil, kernel.BadAuthRequest(s.deps.Failures.UserMessage(task.Error))
	}
	decryptedInput, err := s.deps.Secrets.DecryptInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var taskInput map[string]any
	if err := json.Unmarshal([]byte(decryptedInput), &taskInput); err != nil {
		return nil, err
	}
	if err := s.deps.Catalog.PrepareRetry(task, taskInput); err != nil {
		return nil, err
	}
	if err := s.deps.Catalog.RequireCustomChannels(taskInput); err != nil {
		return nil, err
	}
	// A resumed provider task already owns its uploaded references. Only fresh
	// submissions should be blocked by the current local-media contract.
	if task.ProviderRequestID == "" {
		if err := s.deps.Media.ValidateTransport(userID, taskInput); err != nil {
			return nil, err
		}
	}
	limit, err := s.deps.Policy.ActiveTaskLimit()
	if err != nil {
		return nil, err
	}
	if err := s.deps.Projects.EnsureActive(userID, task.ProjectID); err != nil {
		return nil, err
	}
	nextAttempt := *task
	nextAttempt.RouteRun = task.RouteRun + 1
	// A retry is a new billing attempt. Do not carry a prior settled/refunded hold
	// into a free or locally executed retry.
	nextAttempt.BillingHoldID = ""
	nextAttempt.BillingStatus = ""
	nextAttempt.BillingPoints = 0
	var billingReserved bool
	if s.deps.Billing != nil {
		reservation, reserveErr := s.deps.Billing.Reserve(context.Background(), userID, &nextAttempt)
		if reserveErr != nil {
			return nil, reserveErr
		}
		if reservation != nil && reservation.Enabled {
			nextAttempt.BillingHoldID = reservation.HoldID
			nextAttempt.BillingStatus = reservation.Status
			nextAttempt.BillingPoints = reservation.Points
			billingReserved = true
		}
	}
	retriedTask, err := s.store.Retry(userID, &nextAttempt, limit)
	if err != nil && billingReserved {
		// Concurrent retries share the task:routeRun idempotency hold. If another
		// request won the state transition, this losing request must not release
		// the hold now owned by the queued/running attempt.
		retryOwned := false
		latest, lookupErr := s.store.TaskForUser(userID, task.ID)
		if lookupErr != nil {
			// Unknown task state is safer as a manual reconciliation item than a
			// free generation caused by refunding a hold that another request owns.
			retryOwned = true
			s.log(userID, task.ID, "error", "重试失败后无法确认任务状态，保留预扣待对账", lookupErr.Error())
		} else if latest != nil {
			retryOwned = latest.Status == model.TaskStatusQueued || latest.Status == model.TaskStatusRunning || latest.Status == model.TaskStatusSucceeded
		}
		if !retryOwned {
			if _, releaseErr := s.deps.Billing.Release(context.Background(), &nextAttempt, "任务重试未进入队列，释放预扣"); releaseErr != nil {
				s.log(userID, task.ID, "error", "任务重试失败后释放预扣失败", releaseErr.Error())
			}
		}
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, activeLimitError(limit)
	}
	if errors.Is(err, repository.ErrTaskNotRetryable) {
		return nil, kernel.BadAuthRequest(RetryNotRetryableMessage)
	}
	if mapped := mapTaskScopeError(err); mapped != nil {
		return nil, mapped
	}
	if mapped := mapTaskResourceError(err); mapped != nil {
		return nil, mapped
	}
	if err != nil {
		return nil, err
	}
	task = retriedTask
	s.log(userID, task.ID, "info", "任务已重新入队", "")
	return presentTask(s.deps.Present, *task)
}

func (s *Service) Cancel(ctx context.Context, userID, id string) (*model.Task, error) {
	_ = ctx
	if s.store == nil {
		return nil, kernel.WrapAppError(kernel.CodeInternal, "任务服务不可用", errStoreRequired)
	}
	if s.deps.Runtime == nil || s.deps.Present == nil {
		return nil, unavailable()
	}
	task, err := s.store.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning {
		if task.Status == model.TaskStatusCancelled {
			return presentTask(s.deps.Present, *task)
		}
		return nil, fmt.Errorf("任务当前状态为 %s，无法取消", task.Status)
	}

	s.hydrateProviderRequestID(task)
	now := s.now()
	cancelled, err := s.store.CancelIfStatus(userID, id, task.Status, now)
	if err != nil {
		return nil, err
	}
	if !cancelled {
		latest, latestErr := s.store.TaskForUser(userID, id)
		if latestErr != nil {
			return nil, latestErr
		}
		if latest.Status == model.TaskStatusCancelled {
			return presentTask(s.deps.Present, *latest)
		}
		return nil, errors.New(CancelChangedMessage)
	}

	task.Status = model.TaskStatusCancelled
	task.Stage = "任务已取消"
	task.Error = "任务已取消"
	task.CompletedAt = &now
	s.deps.Runtime.StopLocalWait(task.ID)

	if s.deps.Billing != nil && strings.TrimSpace(task.BillingHoldID) != "" {
		settlement, billingErr := s.deps.Billing.Release(context.Background(), task, "用户取消任务，释放预扣")
		if billingErr != nil {
			task.BillingStatus = "refund_pending"
			s.log(task.UserID, task.ID, "error", "取消任务后退还积分失败", billingErr.Error())
		} else if settlement == nil {
			task.BillingStatus = "refund_pending"
			s.log(task.UserID, task.ID, "error", "取消任务后退还积分缺少响应", "")
		} else {
			switch settlementStatus := strings.TrimSpace(settlement.Status); settlementStatus {
			case "settled":
				task.BillingStatus = "settled"
				task.BillingPoints = settlement.ChargedPoints
			case "pending_reconcile":
				task.BillingStatus = "pending_reconcile"
			default:
				task.BillingStatus = "refunded"
			}
		}
		if updater, ok := s.store.(interface {
			UpdateTaskBilling(userID, taskID, holdID, status string, points int) error
		}); ok {
			_ = updater.UpdateTaskBilling(task.UserID, task.ID, task.BillingHoldID, task.BillingStatus, task.BillingPoints)
		}
	}

	if s.deps.TextReplay != nil {
		if err := s.deps.TextReplay.Finalize(task.ID, model.TaskStatusCancelled); err != nil {
			s.log(task.UserID, task.ID, "error", "取消任务后归并文本回放失败", err.Error())
		}
	}
	s.log(task.UserID, task.ID, "warn", "用户主动取消任务", "")

	if task.ProviderRequestID != "" && s.deps.Provider != nil {
		cancelTask := *task
		run := func() {
			requestCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.deps.Provider.RequestCancel(requestCtx, &cancelTask); err != nil {
				s.log(cancelTask.UserID, cancelTask.ID, "error", "发送上游取消请求失败", err.Error())
			}
		}
		started := false
		if s.deps.Runtime != nil {
			started = s.deps.Runtime.Dispatch(run)
		}
		if !started {
			run()
		}
	}

	return presentTask(s.deps.Present, *task)
}
