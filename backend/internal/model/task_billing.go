package model

// ApplyBillingResult keeps the original reservation while recording the final
// charged and refunded amounts. BillingPoints remains the effective amount for
// existing task consumers.
func (task *Task) ApplyBillingResult(status string, chargedPoints, refundedPoints int) {
	if task == nil {
		return
	}
	task.BillingStatus = status
	switch status {
	case "settled":
		task.BillingSettledPoints = chargedPoints
		task.BillingRefundedPoints = refundedPoints
		task.BillingPoints = chargedPoints
	case "refunded":
		task.BillingSettledPoints = 0
		task.BillingRefundedPoints = refundedPoints
		if task.BillingRefundedPoints <= 0 {
			task.BillingRefundedPoints = task.BillingReservedPoints
		}
		task.BillingPoints = 0
	case "pending_reconcile", "refund_pending":
		if chargedPoints > 0 {
			task.BillingSettledPoints = chargedPoints
		}
		if refundedPoints > 0 {
			task.BillingRefundedPoints = refundedPoints
		}
		task.BillingPoints = task.BillingReservedPoints
	}
}
