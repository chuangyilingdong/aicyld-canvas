package app

import (
	"context"

	billingclient "infinite-canvas/backend/internal/billing"
)

// BillingBalance returns the authoritative main-site points balance. Local
// builds without a billing secret report the feature as disabled.
func (s *Service) BillingBalance(ctx context.Context, userID string) (*billingclient.BillingBalance, error) {
	if s == nil || s.billing == nil || !s.billing.Enabled() {
		return &billingclient.BillingBalance{Enabled: false}, nil
	}
	return s.billing.Balance(ctx, userID)
}
