package app

import (
	"time"

	"infinite-canvas/backend/internal/operations"
)

func (s *Service) ExternalGenerationGuardrail(userID string) operations.ExternalGenerationGuardrail {
	if s == nil || s.repo == nil {
		return operations.ExternalGenerationGuardrail{Mode: operations.ExternalGuardrailModePropose}
	}
	return operations.GetExternalGenerationGuardrail(s.repo.DB(), userID)
}

func (s *Service) SetExternalGenerationGuardrail(userID string, input operations.ExternalGenerationGuardrail) (operations.ExternalGenerationGuardrail, error) {
	if s == nil || s.repo == nil {
		return operations.ExternalGenerationGuardrail{}, operations.Unsupported("guardrail_store_unavailable", "外部 Agent 护栏存储不可用")
	}
	return operations.SetExternalGenerationGuardrail(s.repo.DB(), userID, input)
}

func (s *Service) ExternalGenerationGuardrailStatus(userID string, now time.Time) operations.ExternalGuardrailStatus {
	if s == nil || s.repo == nil {
		return operations.ExternalGuardrailStatus{ExternalGenerationGuardrail: operations.ExternalGenerationGuardrail{Mode: operations.ExternalGuardrailModePropose}}
	}
	return operations.ExternalGuardrailStatus{
		ExternalGenerationGuardrail: s.ExternalGenerationGuardrail(userID),
		TodaySpentCNY:               operations.TodayExternalEstimatedSpendCNY(s.repo.DB(), userID, now),
	}
}

func (s *Service) CheckExternalBusinessPaidGuardrail(userID string) error {
	if s == nil || s.repo == nil {
		return operations.Unsupported("guardrail_store_unavailable", "外部 Agent 护栏存储不可用")
	}
	return operations.CheckExternalBusinessPaidGuardrail(s.repo.DB(), userID)
}
