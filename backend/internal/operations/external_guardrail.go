package operations

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
)

const (
	ExternalGuardrailModeAllow   = "allow"
	ExternalGuardrailModePropose = "propose_only"

	externalGuardrailSettingPrefix = "external_mcp_generation_guardrail:"
	maxExternalPerCallCapCNY       = 10000
	maxExternalDailyBudgetCapCNY   = 100000
)

// ExternalGenerationGuardrail is scoped to one workspace owner. A missing or
// unreadable setting fails closed to propose_only.
type ExternalGenerationGuardrail struct {
	Mode           string  `json:"mode"`
	MaxPerCallCNY  float64 `json:"maxPerCallCny"`
	DailyBudgetCNY float64 `json:"dailyBudgetCny"`
}

type ExternalGuardrailStatus struct {
	ExternalGenerationGuardrail
	TodaySpentCNY float64 `json:"todaySpentCny"`
}

func defaultExternalGenerationGuardrail() ExternalGenerationGuardrail {
	return ExternalGenerationGuardrail{Mode: ExternalGuardrailModePropose}
}

func externalGuardrailSettingKey(userID string) string {
	return externalGuardrailSettingPrefix + strings.TrimSpace(userID)
}

func roundCNY(value float64) float64 {
	return math.Round(value*10000) / 10000
}

func externalBudgetLocation() *time.Location {
	return time.FixedZone("Asia/Shanghai", 8*60*60)
}

func normalizeExternalGenerationGuardrail(cfg ExternalGenerationGuardrail) ExternalGenerationGuardrail {
	if cfg.Mode != ExternalGuardrailModeAllow && cfg.Mode != ExternalGuardrailModePropose {
		return defaultExternalGenerationGuardrail()
	}
	if math.IsNaN(cfg.MaxPerCallCNY) || math.IsInf(cfg.MaxPerCallCNY, 0) || cfg.MaxPerCallCNY < 0 {
		cfg.MaxPerCallCNY = 0
	}
	if math.IsNaN(cfg.DailyBudgetCNY) || math.IsInf(cfg.DailyBudgetCNY, 0) || cfg.DailyBudgetCNY < 0 {
		cfg.DailyBudgetCNY = 0
	}
	cfg.MaxPerCallCNY = roundCNY(cfg.MaxPerCallCNY)
	cfg.DailyBudgetCNY = roundCNY(cfg.DailyBudgetCNY)
	return cfg
}

// GetExternalGenerationGuardrail reads the current user's guardrail. Unknown
// formats and storage failures fail closed instead of silently granting spend.
func GetExternalGenerationGuardrail(db *gorm.DB, userID string) ExternalGenerationGuardrail {
	cfg := defaultExternalGenerationGuardrail()
	if db == nil || strings.TrimSpace(userID) == "" {
		return cfg
	}
	var setting model.SystemSetting
	if err := db.Select("value_json").First(&setting, "key = ?", externalGuardrailSettingKey(userID)).Error; err != nil {
		return cfg
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &cfg); err != nil {
		return defaultExternalGenerationGuardrail()
	}
	return normalizeExternalGenerationGuardrail(cfg)
}

// SetExternalGenerationGuardrail validates and persists the user's policy.
func SetExternalGenerationGuardrail(db *gorm.DB, userID string, input ExternalGenerationGuardrail) (ExternalGenerationGuardrail, error) {
	if db == nil || strings.TrimSpace(userID) == "" {
		return ExternalGenerationGuardrail{}, errors.New("执行护栏设置的用户或存储不可用")
	}
	mode := strings.TrimSpace(input.Mode)
	if mode == "" {
		mode = ExternalGuardrailModePropose
	}
	if mode != ExternalGuardrailModeAllow && mode != ExternalGuardrailModePropose {
		return ExternalGenerationGuardrail{}, InvalidArg("invalid_guardrail_mode", "外部 Agent 护栏模式只能是 allow 或 propose_only")
	}
	if math.IsNaN(input.MaxPerCallCNY) || math.IsInf(input.MaxPerCallCNY, 0) || input.MaxPerCallCNY < 0 || input.MaxPerCallCNY > maxExternalPerCallCapCNY {
		return ExternalGenerationGuardrail{}, InvalidArg("invalid_guardrail_cap", fmt.Sprintf("单次上限必须在 0 到 %d 元之间", maxExternalPerCallCapCNY))
	}
	if math.IsNaN(input.DailyBudgetCNY) || math.IsInf(input.DailyBudgetCNY, 0) || input.DailyBudgetCNY < 0 || input.DailyBudgetCNY > maxExternalDailyBudgetCapCNY {
		return ExternalGenerationGuardrail{}, InvalidArg("invalid_guardrail_cap", fmt.Sprintf("每日上限必须在 0 到 %d 元之间", maxExternalDailyBudgetCapCNY))
	}
	clean := ExternalGenerationGuardrail{Mode: mode, MaxPerCallCNY: roundCNY(input.MaxPerCallCNY), DailyBudgetCNY: roundCNY(input.DailyBudgetCNY)}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return ExternalGenerationGuardrail{}, err
	}
	setting := model.SystemSetting{Key: externalGuardrailSettingKey(userID), ValueJSON: string(encoded), UpdatedBy: strings.TrimSpace(userID)}
	if err := db.Save(&setting).Error; err != nil {
		return ExternalGenerationGuardrail{}, err
	}
	return clean, nil
}

func TodayExternalEstimatedSpendCNY(db *gorm.DB, userID string, now time.Time) float64 {
	if db == nil || strings.TrimSpace(userID) == "" {
		return 0
	}
	day := now.In(externalBudgetLocation()).Format("2006-01-02")
	var usage model.ExternalAgentDailyUsage
	if err := db.Select("estimated_cny").First(&usage, "user_id = ? AND day = ?", userID, day).Error; err != nil {
		return 0
	}
	return roundCNY(usage.EstimatedCNY)
}

// EvaluateExternalGenerationGuardrail is the pure policy decision used after a
// real quote has been obtained. Unknown pricing is always rejected, including
// when no numeric caps are configured.
func EvaluateExternalGenerationGuardrail(cfg ExternalGenerationGuardrail, estimatedCNY float64, priceKnown bool, todaySpentCNY float64) error {
	if cfg.Mode == ExternalGuardrailModePropose {
		return PermissionDenied("external_generation_propose_only", "当前工作区仅允许外部 Agent 提交生成草稿；请由用户确认生成单，或在「灵动TV MCP」页调整护栏")
	}
	if !priceKnown || math.IsNaN(estimatedCNY) || math.IsInf(estimatedCNY, 0) || estimatedCNY < 0 {
		return PreconditionFailed("external_budget_price_unknown", "外部 Agent 本次生成未能取得固定报价，已按资金安全策略阻止直接提交", map[string]any{
			"maxPerCallCny":  cfg.MaxPerCallCNY,
			"dailyBudgetCny": cfg.DailyBudgetCNY,
		})
	}
	estimatedCNY = roundCNY(estimatedCNY)
	todaySpentCNY = roundCNY(todaySpentCNY)
	if cfg.MaxPerCallCNY > 0 && estimatedCNY > cfg.MaxPerCallCNY {
		return PreconditionFailed("external_per_call_budget_exceeded", fmt.Sprintf("本次外部生成预估 ¥%.4f，超过单次上限 ¥%.2f", estimatedCNY, cfg.MaxPerCallCNY), map[string]any{
			"estimatedCny":  estimatedCNY,
			"maxPerCallCny": cfg.MaxPerCallCNY,
		})
	}
	if cfg.DailyBudgetCNY > 0 && roundCNY(todaySpentCNY+estimatedCNY) > cfg.DailyBudgetCNY {
		return PreconditionFailed("external_daily_budget_exceeded", fmt.Sprintf("今日外部生成已预估消耗 ¥%.4f，加上本次 ¥%.4f 将超过每日上限 ¥%.2f", todaySpentCNY, estimatedCNY, cfg.DailyBudgetCNY), map[string]any{
			"estimatedCny":   estimatedCNY,
			"todaySpentCny":  todaySpentCNY,
			"dailyBudgetCny": cfg.DailyBudgetCNY,
		})
	}
	return nil
}

// ReserveExternalEstimatedSpend atomically adds the quoted amount to today's
// ledger. The operation transaction rolls this back if task admission fails.
func ReserveExternalEstimatedSpend(db *gorm.DB, userID string, amountCNY, dailyBudgetCNY float64, now time.Time) (float64, error) {
	if db == nil || strings.TrimSpace(userID) == "" {
		return 0, errors.New("外部 Agent 日用量存储不可用")
	}
	if math.IsNaN(amountCNY) || math.IsInf(amountCNY, 0) || amountCNY < 0 || math.IsNaN(dailyBudgetCNY) || math.IsInf(dailyBudgetCNY, 0) || dailyBudgetCNY < 0 {
		return 0, InvalidArg("invalid_guardrail_amount", "外部 Agent 预估金额无效")
	}
	amountCNY = roundCNY(amountCNY)
	dailyBudgetCNY = roundCNY(dailyBudgetCNY)
	day := now.In(externalBudgetLocation()).Format("2006-01-02")
	updatedAt := now.UTC()

	update := func() (int64, error) {
		query := db.Model(&model.ExternalAgentDailyUsage{}).Where("user_id = ? AND day = ?", userID, day)
		if dailyBudgetCNY > 0 {
			query = query.Where("estimated_cny + ? <= ?", amountCNY, dailyBudgetCNY)
		}
		result := query.Updates(map[string]any{
			"estimated_cny": gorm.Expr("estimated_cny + ?", amountCNY),
			"updated_at":    updatedAt,
		})
		return result.RowsAffected, result.Error
	}

	rows, err := update()
	if err != nil {
		return 0, err
	}
	if rows == 0 {
		var existing model.ExternalAgentDailyUsage
		findErr := db.First(&existing, "user_id = ? AND day = ?", userID, day).Error
		if findErr == nil {
			return 0, dailyBudgetExceeded(existing.EstimatedCNY, amountCNY, dailyBudgetCNY)
		}
		if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return 0, findErr
		}
		if dailyBudgetCNY > 0 && amountCNY > dailyBudgetCNY {
			return 0, dailyBudgetExceeded(0, amountCNY, dailyBudgetCNY)
		}
		usage := model.ExternalAgentDailyUsage{UserID: userID, Day: day, EstimatedCNY: amountCNY, CreatedAt: updatedAt, UpdatedAt: updatedAt}
		if err := db.Create(&usage).Error; err != nil {
			if !isDuplicateKey(err) {
				return 0, err
			}
			rows, retryErr := update()
			if retryErr != nil {
				return 0, retryErr
			}
			if rows == 0 {
				_ = db.First(&existing, "user_id = ? AND day = ?", userID, day).Error
				return 0, dailyBudgetExceeded(existing.EstimatedCNY, amountCNY, dailyBudgetCNY)
			}
		} else {
			return amountCNY, nil
		}
	}
	var usage model.ExternalAgentDailyUsage
	if err := db.Select("estimated_cny").First(&usage, "user_id = ? AND day = ?", userID, day).Error; err != nil {
		return 0, err
	}
	return roundCNY(usage.EstimatedCNY), nil
}

func dailyBudgetExceeded(todaySpentCNY, amountCNY, dailyBudgetCNY float64) error {
	return PreconditionFailed("external_daily_budget_exceeded", fmt.Sprintf("今日外部生成已预估消耗 ¥%.4f，加上本次 ¥%.4f 将超过每日上限 ¥%.2f", todaySpentCNY, amountCNY, dailyBudgetCNY), map[string]any{
		"estimatedCny":   roundCNY(amountCNY),
		"todaySpentCny":  roundCNY(todaySpentCNY),
		"dailyBudgetCny": roundCNY(dailyBudgetCNY),
	})
}

// CheckExternalBusinessPaidGuardrail protects raw paid business routes that
// cannot produce a verified fixed quote. Under caps they fail closed and must
// use canvas.generation.propose/submit instead.
func CheckExternalBusinessPaidGuardrail(db *gorm.DB, userID string) error {
	cfg := GetExternalGenerationGuardrail(db, userID)
	if cfg.Mode == ExternalGuardrailModePropose {
		return PermissionDenied("external_generation_propose_only", "当前工作区仅允许外部 Agent 提交生成草稿；请改用 canvas.generation.propose 并由用户批准")
	}
	if cfg.MaxPerCallCNY > 0 || cfg.DailyBudgetCNY > 0 {
		return PreconditionFailed("external_budget_price_unknown", "当前启用了外部 Agent 付费上限，但该底层接口无法预先取得固定报价，已阻止直接提交；请改用 canvas.generation.submit", map[string]any{
			"maxPerCallCny":  cfg.MaxPerCallCNY,
			"dailyBudgetCny": cfg.DailyBudgetCNY,
		})
	}
	return nil
}
