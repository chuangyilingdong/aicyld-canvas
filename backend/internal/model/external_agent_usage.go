package model

import "time"

// ExternalAgentDailyUsage is the per-user, per-day reservation ledger for
// external MCP/CLI paid generation. Estimated amounts are reserved in the same
// transaction as task admission so concurrent calls cannot overspend a daily cap.
type ExternalAgentDailyUsage struct {
	UserID       string    `json:"userId" gorm:"primaryKey;size:36"`
	Day          string    `json:"day" gorm:"primaryKey;size:10"`
	EstimatedCNY float64   `json:"estimatedCny" gorm:"not null;default:0"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}
