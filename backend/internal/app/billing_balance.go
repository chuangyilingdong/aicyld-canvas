package app

import (
	"context"

	"infinite-canvas/backend/internal/model"
)

// BillingBalance returns the authoritative main-site points balance for the
// signed-in canvas user. Local/desktop builds without a billing secret report
// the feature as disabled instead of inventing a balance.
func (s *Service) BillingBalance(ctx context.Context, userID string) (*model.BillingBalance, error) {
	if s == nil || s.billing == nil || !s.billing.Enabled() {
		return &model.BillingBalance{Enabled: false}, nil
	}
	return s.billing.Balance(ctx, userID)
}
