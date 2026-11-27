package operations

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/model"
)

func newGuardrailDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "guardrail.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ExternalAgentDailyUsage{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestExternalGuardrailDefaultsToProposeAndIsUserScoped(t *testing.T) {
	db := newGuardrailDB(t)
	if got := GetExternalGenerationGuardrail(db, "user-a"); got.Mode != ExternalGuardrailModePropose {
		t.Fatalf("default mode = %q", got.Mode)
	}
	if _, err := SetExternalGenerationGuardrail(db, "user-a", ExternalGenerationGuardrail{Mode: ExternalGuardrailModeAllow, MaxPerCallCNY: 12}); err != nil {
		t.Fatal(err)
	}
	if got := GetExternalGenerationGuardrail(db, "user-a"); got.Mode != ExternalGuardrailModeAllow || got.MaxPerCallCNY != 12 {
		t.Fatalf("user-a = %+v", got)
	}
	if got := GetExternalGenerationGuardrail(db, "user-b"); got.Mode != ExternalGuardrailModePropose || got.MaxPerCallCNY != 0 {
		t.Fatalf("user-b leaked user-a setting: %+v", got)
	}
}

func TestEvaluateExternalGenerationGuardrailFailsClosed(t *testing.T) {
	allow := ExternalGenerationGuardrail{Mode: ExternalGuardrailModeAllow, MaxPerCallCNY: 10, DailyBudgetCNY: 25}
	cases := []struct {
		name       string
		cfg        ExternalGenerationGuardrail
		amount     float64
		known      bool
		spent      float64
		wantReason string
	}{
		{name: "propose only", cfg: ExternalGenerationGuardrail{Mode: ExternalGuardrailModePropose}, amount: 1, known: true, wantReason: "external_generation_propose_only"},
		{name: "unknown with no caps", cfg: ExternalGenerationGuardrail{Mode: ExternalGuardrailModeAllow}, known: false, wantReason: "external_budget_price_unknown"},
		{name: "per call", cfg: allow, amount: 11, known: true, wantReason: "external_per_call_budget_exceeded"},
		{name: "daily", cfg: allow, amount: 8, known: true, spent: 20, wantReason: "external_daily_budget_exceeded"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := EvaluateExternalGenerationGuardrail(tc.cfg, tc.amount, tc.known, tc.spent)
			var opErr *Error
			if !errors.As(err, &opErr) || opErr.Reason != tc.wantReason {
				t.Fatalf("err = %v, want %s", err, tc.wantReason)
			}
		})
	}
	if err := EvaluateExternalGenerationGuardrail(allow, 10, true, 15); err != nil {
		t.Fatalf("exact cap should pass: %v", err)
	}
}

func TestReserveExternalEstimatedSpendEnforcesDailyCapAndPersists(t *testing.T) {
	db := newGuardrailDB(t)
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, externalBudgetLocation())
	total, err := ReserveExternalEstimatedSpend(db, "user-a", 7.25, 10, now)
	if err != nil || total != 7.25 {
		t.Fatalf("first reserve total=%v err=%v", total, err)
	}
	if _, err := ReserveExternalEstimatedSpend(db, "user-a", 2.75, 10, now); err != nil {
		t.Fatalf("second reserve should fit: %v", err)
	}
	if _, err := ReserveExternalEstimatedSpend(db, "user-a", 0.01, 10, now); err == nil || AsError(err).Reason != "external_daily_budget_exceeded" {
		t.Fatalf("third reserve should exceed: %v", err)
	}
	if got := TodayExternalEstimatedSpendCNY(db, "user-a", now); got != 10 {
		t.Fatalf("today spend = %v", got)
	}
	if got := TodayExternalEstimatedSpendCNY(db, "user-b", now); got != 0 {
		t.Fatalf("other user spend = %v", got)
	}
}

func TestExternalBusinessPaidGuardrailRejectsUnknownQuoteUnderCaps(t *testing.T) {
	db := newGuardrailDB(t)
	if _, err := SetExternalGenerationGuardrail(db, "user-a", ExternalGenerationGuardrail{Mode: ExternalGuardrailModeAllow, DailyBudgetCNY: 50}); err != nil {
		t.Fatal(err)
	}
	err := CheckExternalBusinessPaidGuardrail(db, "user-a")
	if err == nil || AsError(err).Reason != "external_budget_price_unknown" {
		t.Fatalf("err = %v", err)
	}
}
