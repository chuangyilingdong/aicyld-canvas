package app

import (
	"context"
	"log"
	"time"

	"infinite-canvas/backend/internal/model"
)

const (
	canvasBillingReconcileInterval = 10 * time.Minute
	canvasBillingTerminalGrace     = 10 * time.Minute
	canvasBillingStuckGrace        = 2 * time.Hour
)

// startCanvasBillingReconciliation finishes billing transitions that were
// interrupted after a terminal task write. It never touches a live provider
// request; stale pre-dispatch tasks are failed only after their lease expires.
func (s *Service) startCanvasBillingReconciliation(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		reconcile := func() {
			if ctx.Err() != nil || s.IsDraining() {
				return
			}
			if err := s.reconcileCanvasBillingOnce(ctx); err != nil {
				log.Printf("canvas billing reconciliation paused: worker_id=%s error=%v", s.workerID, err)
			}
		}
		reconcile()
		ticker := time.NewTicker(canvasBillingReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				reconcile()
			}
		}
	})
}

func (s *Service) reconcileCanvasBillingOnce(ctx context.Context) error {
	if s == nil || s.repo == nil || s.billing == nil || !s.billing.Enabled() {
		return nil
	}
	now := time.Now()
	tasks, err := s.repo.StaleReservedTasks(now.Add(-canvasBillingTerminalGrace), 100)
	if err != nil {
		return err
	}
	terminal := s.terminalCoordinator()
	for index := range tasks {
		if ctx.Err() != nil {
			return nil
		}
		task := tasks[index]
		switch task.Status {
		case model.TaskStatusSucceeded:
			_ = terminal.handleSuccess(&task)
		case model.TaskStatusFailed, model.TaskStatusCancelled:
			terminal.releaseBilling(&task, "任务已结束但预扣未释放，自动原路退款")
		case model.TaskStatusQueued:
			if task.BillingStatus != "reserved" {
				continue
			}
			cutoff := now.Add(-canvasBillingStuckGrace)
			if task.UpdatedAt.After(cutoff) {
				continue
			}
			message := "任务长时间未调度，已自动结束并退回预扣积分"
			failed, failErr := s.repo.FailStaleQueuedReservedTask(task.ID, cutoff, message)
			if failErr != nil {
				return failErr
			}
			if failed {
				task.Status = model.TaskStatusFailed
				task.Stage = "预扣对账"
				task.Error = message
				terminal.releaseBilling(&task, message)
			}
		case model.TaskStatusRunning:
			if task.BillingStatus != "reserved" {
				continue
			}
			if task.ProviderRequestID != "" {
				continue
			}
			cutoff := now.Add(-canvasBillingStuckGrace)
			if task.UpdatedAt.After(cutoff) {
				continue
			}
			message := "任务长时间未开始上游请求，已自动结束并退回预扣积分"
			failed, failErr := s.repo.FailStaleRunningReservedTask(task.ID, cutoff, message)
			if failErr != nil {
				return failErr
			}
			if failed {
				task.Status = model.TaskStatusFailed
				task.Stage = "预扣对账"
				task.Error = message
				terminal.releaseBilling(&task, message)
			}
		}
	}
	if counts, countErr := s.repo.TaskBillingStatusCounts(); countErr == nil {
		for _, item := range counts {
			if item.Status == "refund_pending" || item.Status == "pending_reconcile" {
				log.Printf("canvas billing attention: worker_id=%s status=%s count=%d", s.workerID, item.Status, item.Count)
			}
		}
	}
	return nil
}
