package app

import (
	"context"

	billingclient "infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type taskBillingAdapter struct{ s *Service }

func (a taskBillingAdapter) Quote(ctx context.Context, userID string, task *model.Task) (*model.BillingQuote, error) {
	if a.s == nil || a.s.billing == nil {
		return &model.BillingQuote{Enabled: false}, nil
	}
	quote, err := a.s.billing.Quote(ctx, userID, task)
	if err == nil {
		return quote, nil
	}
	if billingclient.IsRuleMissing(err) {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	return nil, err
}

func (a taskBillingAdapter) Reserve(ctx context.Context, userID string, task *model.Task) (*model.BillingReservation, error) {
	if a.s == nil || a.s.billing == nil {
		return &model.BillingReservation{Enabled: false, Status: "free"}, nil
	}
	reservation, err := a.s.billing.Reserve(ctx, userID, task)
	if err == nil {
		return reservation, nil
	}
	if billingclient.IsInsufficient(err) {
		return nil, kernel.NewAppError(402, err.Error())
	}
	if billingclient.IsRuleMissing(err) {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	return nil, err
}

func (a taskBillingAdapter) Settle(ctx context.Context, task *model.Task, outcome string, reason string) (*model.BillingSettlement, error) {
	if a.s == nil || a.s.billing == nil {
		return &model.BillingSettlement{Status: "free"}, nil
	}
	return a.s.billing.Settle(ctx, task, outcome, reason)
}

func (a taskBillingAdapter) Release(ctx context.Context, task *model.Task, reason string) (*model.BillingSettlement, error) {
	if a.s == nil || a.s.billing == nil {
		return &model.BillingSettlement{Status: "free"}, nil
	}
	return a.s.billing.Release(ctx, task, reason)
}
