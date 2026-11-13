package task

import (
	"context"
	"strings"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
)

type billingUpdater interface {
	UpdateTaskBilling(userID, taskID, holdID, status string, points int) error
}

// QuoteTask prepares the same normalized task shape as CreateTask and returns a
// main-site points quote without persisting the task or calling upstream.
func (s *Service) QuoteTask(userID string, request CreateRequest) (*billingclient.BillingQuote, error) {
	request.PrepareOnly = true
	task, err := s.admit(userID, request)
	if err != nil {
		return nil, err
	}
	if s.deps.Billing == nil || !s.deps.Billing.Enabled() {
		return &billingclient.BillingQuote{Enabled: false}, nil
	}
	return s.deps.Billing.Quote(context.Background(), userID, task)
}

func (s *Service) reserveBilling(userID string, task *model.Task) (bool, error) {
	if s == nil || s.deps.Billing == nil || task == nil {
		return false, nil
	}
	reservation, err := s.deps.Billing.Reserve(context.Background(), userID, task)
	if err != nil {
		return false, err
	}
	if reservation == nil || !reservation.Enabled {
		return false, nil
	}
	task.BillingHoldID = reservation.HoldID
	task.BillingStatus = reservation.Status
	task.BillingPoints = reservation.Points
	return true, nil
}

func (s *Service) releaseBilling(task *model.Task, reason string) {
	if s == nil || s.deps.Billing == nil || task == nil || strings.TrimSpace(task.BillingHoldID) == "" {
		return
	}
	settlement, err := s.deps.Billing.Release(context.Background(), task, reason)
	if err != nil || settlement == nil {
		task.BillingStatus = "refund_pending"
		s.updateTaskBilling(task)
		s.log(task.UserID, task.ID, "error", "积分退款失败，等待对账", errorText(err))
		return
	}
	applyBillingSettlement(task, settlement)
	s.updateTaskBilling(task)
}

func (s *Service) markBillingPending(task *model.Task) {
	if s == nil || task == nil || strings.TrimSpace(task.BillingHoldID) == "" {
		return
	}
	task.BillingStatus = "pending_reconcile"
	s.updateTaskBilling(task)
}

func (s *Service) updateTaskBilling(task *model.Task) {
	if s == nil || task == nil {
		return
	}
	if updater, ok := s.store.(billingUpdater); ok {
		_ = updater.UpdateTaskBilling(task.UserID, task.ID, task.BillingHoldID, task.BillingStatus, task.BillingPoints)
	}
}

func applyBillingSettlement(task *model.Task, settlement *billingclient.BillingSettlement) {
	if task == nil || settlement == nil {
		return
	}
	switch strings.TrimSpace(settlement.Status) {
	case "settled":
		task.BillingStatus = "settled"
		task.BillingPoints = settlement.ChargedPoints
	case "pending_reconcile":
		task.BillingStatus = "pending_reconcile"
	case "refunded":
		task.BillingStatus = "refunded"
	default:
		task.BillingStatus = "pending_reconcile"
	}
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
