package taskruntime

import (
	"context"
	"strings"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
)

type terminalBillingUpdater interface {
	UpdateTaskBilling(userID, taskID, holdID, status string, points int) error
}

func (c *Terminal) settleBilling(task *model.Task, reason string) {
	if c == nil || c.billing == nil || task == nil || strings.TrimSpace(task.BillingHoldID) == "" || task.BillingStatus == "settled" || task.BillingStatus == "refunded" {
		return
	}
	settlement, err := c.billing.Settle(context.Background(), task, "succeeded", reason)
	if err != nil || settlement == nil {
		c.billingPending(task, "积分结算失败，等待对账", err)
		return
	}
	if settlement.Pending || settlement.Status == "pending_reconcile" {
		c.billingPending(task, "实际用量超过预扣且余额不足，等待对账", nil)
		return
	}
	applyTerminalBillingSettlement(task, settlement)
	c.updateTaskBilling(task)
}

func (c *Terminal) releaseBilling(task *model.Task, reason string) {
	if c == nil || c.billing == nil || task == nil || strings.TrimSpace(task.BillingHoldID) == "" || task.BillingStatus == "refunded" || task.BillingStatus == "settled" {
		return
	}
	settlement, err := c.billing.Release(context.Background(), task, reason)
	if err != nil || settlement == nil {
		task.BillingStatus = "refund_pending"
		c.updateTaskBilling(task)
		c.billingLog(task, "error", "积分退款失败，等待对账", err)
		return
	}
	applyTerminalBillingSettlement(task, settlement)
	c.updateTaskBilling(task)
}

func (c *Terminal) markBillingPending(task *model.Task, reason string) {
	if c == nil || task == nil || strings.TrimSpace(task.BillingHoldID) == "" {
		return
	}
	task.BillingStatus = "pending_reconcile"
	c.updateTaskBilling(task)
	c.billingLog(task, "warn", reason, nil)
}

func (c *Terminal) billingPending(task *model.Task, reason string, err error) {
	if c == nil || task == nil {
		return
	}
	task.BillingStatus = "pending_reconcile"
	c.updateTaskBilling(task)
	c.billingLog(task, "error", reason, err)
}

func (c *Terminal) updateTaskBilling(task *model.Task) {
	if c == nil || task == nil {
		return
	}
	if updater, ok := c.repo.(terminalBillingUpdater); ok {
		_ = updater.UpdateTaskBilling(task.UserID, task.ID, task.BillingHoldID, task.BillingStatus, task.BillingPoints)
	}
}

func (c *Terminal) billingLog(task *model.Task, level, message string, err error) {
	if c == nil || c.logger == nil || task == nil {
		return
	}
	payload := ""
	if err != nil {
		payload = err.Error()
	}
	_ = c.logger.Log(task.UserID, task.ID, level, message, payload)
}

func applyTerminalBillingSettlement(task *model.Task, settlement *billingclient.BillingSettlement) {
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
