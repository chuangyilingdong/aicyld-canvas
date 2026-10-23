package billing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// Client talks to the main-site points ledger. It is intentionally disabled in
// local/desktop mode unless CANVAS_BILLING_SECRET is explicitly configured.
type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

func NewFromEnv() *Client {
	secret := strings.TrimSpace(os.Getenv("CANVAS_BILLING_SECRET"))
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_BILLING_URL")), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:3001"
	}
	return &Client{baseURL: baseURL, secret: secret, http: &http.Client{Timeout: 12 * time.Second}}
}

func (c *Client) Enabled() bool { return c != nil && c.secret != "" }

type apiError struct {
	Status  int
	Code    string
	Message string
}

func (e *apiError) Error() string { return e.Message }

func IsInsufficient(err error) bool {
	var target *apiError
	return errors.As(err, &target) && target.Code == "POINTS_INSUFFICIENT"
}

func IsRuleMissing(err error) bool {
	var target *apiError
	return errors.As(err, &target) && target.Code == "BILLING_RULE_MISSING"
}

func (c *Client) Quote(ctx context.Context, userID string, task *model.Task) (*model.BillingQuote, error) {
	if !c.Enabled() || task == nil || !Billable(task) {
		return &model.BillingQuote{Enabled: false}, nil
	}
	body := map[string]any{"userId": mainUserID(userID), "facts": Facts(task)}
	var quote model.BillingQuote
	if err := c.post(ctx, "/quote", body, &quote); err != nil {
		return nil, err
	}
	return &quote, nil
}

func (c *Client) Balance(ctx context.Context, userID string) (*model.BillingBalance, error) {
	if !c.Enabled() {
		return &model.BillingBalance{Enabled: false}, nil
	}
	body := map[string]any{"userId": mainUserID(userID)}
	var balance model.BillingBalance
	if err := c.post(ctx, "/balance", body, &balance); err != nil {
		return nil, err
	}
	return &balance, nil
}

func (c *Client) Reserve(ctx context.Context, userID string, task *model.Task) (*model.BillingReservation, error) {
	if !c.Enabled() || task == nil || !Billable(task) {
		return &model.BillingReservation{Enabled: false, Status: "free"}, nil
	}
	routeRun := task.RouteRun
	if routeRun < 1 {
		routeRun = 1
	}
	body := map[string]any{
		"userId":         mainUserID(userID),
		"idempotencyKey": task.ID + ":" + strconv.Itoa(routeRun),
		"taskId":         task.ID,
		"projectId":      task.ProjectID,
		"facts":          Facts(task),
	}
	var reservation model.BillingReservation
	if err := c.post(ctx, "/reserve", body, &reservation); err != nil {
		return nil, err
	}
	return &reservation, nil
}

func mainUserID(canvasUserID string) string {
	return strings.TrimPrefix(strings.TrimSpace(canvasUserID), "sso_")
}

func (c *Client) Settle(ctx context.Context, task *model.Task, outcome string, reason string) (*model.BillingSettlement, error) {
	if !c.Enabled() || task == nil || strings.TrimSpace(task.BillingHoldID) == "" {
		return &model.BillingSettlement{Status: "free"}, nil
	}
	body := map[string]any{
		"holdId":      task.BillingHoldID,
		"outcome":     outcome,
		"reason":      reason,
		"actualFacts": Facts(task),
	}
	var settlement model.BillingSettlement
	if err := c.post(ctx, "/settle", body, &settlement); err != nil {
		return nil, err
	}
	return &settlement, nil
}

func (c *Client) Release(ctx context.Context, task *model.Task, reason string) (*model.BillingSettlement, error) {
	return c.Settle(ctx, task, "failed", reason)
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/internal/canvas-billing"+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("x-canvas-billing-secret", c.secret)
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("画布计费服务不可用：%w", err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = json.NewDecoder(resp.Body).Decode(&envelope)
		if envelope.Error == "" {
			envelope.Error = "画布计费请求失败"
		}
		return &apiError{Status: resp.StatusCode, Code: envelope.Code, Message: envelope.Error}
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("解析画布计费响应失败：%w", err)
		}
	}
	return nil
}

// Billable excludes local executors and private text persistence. The main
// service still re-checks the model rule, so this is only a fast local guard.
func Billable(task *model.Task) bool {
	if task == nil || strings.TrimSpace(task.Model) == "" || strings.TrimSpace(task.Provider) == "local" {
		return false
	}
	switch task.Type {
	case "timeline_render", "timeline_transcription", "depth_capture", "canvas_text", "text":
		return false
	default:
		return true
	}
}

// Facts extracts only the parameters needed for pricing. It never forwards
// API keys, channel credentials, prompts, media bytes or headers to the main site.
func Facts(task *model.Task) map[string]any {
	input := map[string]any{}
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	config, _ := input["config"].(map[string]any)
	videoParameters, _ := input["videoParameters"].(map[string]any)
	metadata, _ := input["metadata"].(map[string]any)
	modelKey := firstString(config["providerModelKey"], config["channelModelKey"], config["model"], videoParameters["model"], task.Model)
	category := categoryFor(task)
	duration := firstInt(config["videoSeconds"], videoParameters["videoSeconds"], input["videoSeconds"], config["duration"], videoParameters["duration"], input["duration"], metadata["duration_seconds"])
	if raw := firstString(config["duration"], input["duration"], metadata["duration"]); raw == "-1" {
		duration = 1
	}
	if duration <= 0 {
		duration = defaultDuration(task, modelKey)
	}
	if duration == 1 && firstString(config["duration"], input["duration"], metadata["duration"]) == "-1" {
		duration = maxDurationFor(modelKey)
	}
	resolution := normalizeResolution(firstString(config["vquality"], config["resolution"], videoParameters["vquality"], videoParameters["resolution"], metadata["resolution"], metadata["upscaleResolution"]))
	quality := strings.ToLower(firstString(config["quality"], metadata["quality"], metadata["upscaleQuality"]))
	speed := strings.ToLower(firstString(config["speed"], metadata["speed"]))
	outputs := firstInt(config["count"], videoParameters["count"], input["count"], config["n"], input["n"], config["outputCount"])
	if outputs <= 0 {
		outputs = 1
	}
	batch := firstInt(config["batch_size"], config["batchSize"], input["batch_size"], input["batchSize"])
	if batch <= 0 {
		batch = 1
	}
	generateAudio := false
	if value, ok := config["videoGenerateAudio"].(string); ok {
		generateAudio = strings.EqualFold(value, "true")
	} else if value, ok := config["videoGenerateAudio"].(bool); ok {
		generateAudio = value
	} else if value, ok := videoParameters["videoGenerateAudio"].(string); ok {
		generateAudio = strings.EqualFold(value, "true")
	} else if value, ok := videoParameters["videoGenerateAudio"].(bool); ok {
		generateAudio = value
	}
	sourceDuration := firstFloat(metadata["sourceDurationSeconds"])
	if raw, ok := metadata["sourceDurationMs"]; ok {
		if milliseconds := firstFloat(raw); milliseconds > 0 {
			sourceDuration = milliseconds / 1000
		}
	}
	return map[string]any{
		"billable":              Billable(task),
		"modelKey":              modelKey,
		"providerModelKey":      firstString(config["providerModelKey"], modelKey),
		"displayName":           firstString(config["displayName"], modelKey),
		"category":              category,
		"operation":             task.Operation,
		"resolution":            resolution,
		"quality":               quality,
		"speed":                 speed,
		"durationSeconds":       duration,
		"outputCount":           outputs,
		"batchCount":            batch,
		"generateAudio":         generateAudio,
		"sourceDurationSeconds": sourceDuration,
	}
}

func categoryFor(task *model.Task) string {
	switch {
	case strings.Contains(task.Type, "video"):
		return "video"
	case strings.Contains(task.Type, "image"):
		return "image"
	case strings.Contains(task.Type, "audio"):
		return "audio"
	case strings.Contains(task.Type, "upscale"):
		return "upscale"
	default:
		return "image"
	}
}

func normalizeResolution(value string) string {
	resolution := strings.ToLower(strings.TrimSpace(value))
	if resolution == "" {
		return ""
	}
	if _, err := strconv.Atoi(resolution); err == nil {
		return resolution + "p"
	}
	return resolution
}

func defaultDuration(task *model.Task, modelKey string) int {
	if strings.Contains(strings.ToLower(modelKey), "minimax-h3") {
		return 5
	}
	if strings.Contains(strings.ToLower(modelKey), "seedance") {
		return 6
	}
	if strings.Contains(task.Type, "video") {
		return 5
	}
	return 1
}

func maxDurationFor(modelKey string) int {
	if strings.Contains(strings.ToLower(modelKey), "minimax-h3") {
		return 15
	}
	return 30
}

func firstString(values ...any) string {
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case fmt.Stringer:
			if strings.TrimSpace(typed.String()) != "" {
				return strings.TrimSpace(typed.String())
			}
		}
	}
	return ""
}

func firstInt(values ...any) int {
	for _, value := range values {
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				return typed
			}
		case int64:
			if typed > 0 {
				return int(typed)
			}
		case float64:
			if typed > 0 {
				return int(typed)
			}
		case json.Number:
			if parsed, err := typed.Int64(); err == nil && parsed > 0 {
				return int(parsed)
			}
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func firstFloat(values ...any) float64 {
	for _, value := range values {
		switch typed := value.(type) {
		case float64:
			if typed > 0 {
				return typed
			}
		case int:
			if typed > 0 {
				return float64(typed)
			}
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}
