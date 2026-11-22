package generation

import (
	"encoding/json"
	"fmt"
	"strings"
)

func FailureDetails(payload map[string]any) (string, string) {
	candidates := make([]map[string]any, 0, 3)
	for _, key := range []string{"error", "data"} {
		if nested, ok := payload[key].(map[string]any); ok {
			candidates = append(candidates, nested)
		}
	}
	candidates = append(candidates, payload)
	code := ""
	message := ""
	for _, candidate := range candidates {
		if code == "" {
			code = normalizedUpstreamErrorCode(firstPayloadValue(candidate, "code", "errorCode", "error_code"))
		}
		if message == "" {
			message = firstPayloadString(candidate, "message", "msg", "errorMessage", "error_message")
		}
	}
	return code, truncateRunes(message, 500)
}

func ResponseBusinessFailure(responseBody []byte) (string, string, bool) {
	if len(responseBody) == 0 {
		return "", "", false
	}
	var payload map[string]any
	if json.Unmarshal(responseBody, &payload) != nil {
		return "", "", false
	}
	return PayloadBusinessFailure(payload)
}

func PayloadBusinessFailure(payload map[string]any) (string, string, bool) {
	if message, ok := payload["error"].(string); ok && strings.TrimSpace(message) != "" {
		return normalizedUpstreamErrorCode(payload["code"]), message, true
	}
	if errorValue, ok := payload["error"].(map[string]any); ok {
		code, message := FailureDetails(map[string]any{"error": errorValue})
		if code != "" || message != "" {
			return code, message, true
		}
	}
	if success, ok := payload["success"].(bool); ok && !success {
		code, message := FailureDetails(payload)
		return code, message, true
	}
	errorCode := firstPayloadValue(payload, "errorCode", "error_code")
	if businessCodeFailed(errorCode) {
		message := firstPayloadString(payload, "errorMessage", "error_message", "message", "msg")
		return normalizedUpstreamErrorCode(errorCode), message, true
	}
	if !businessCodeFailed(payload["code"]) {
		return "", "", false
	}
	code, message := FailureDetails(payload)
	return code, message, true
}

func firstPayloadValue(payload map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := payload[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func firstPayloadString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if message := strings.TrimSpace(stringMapField(payload, key)); message != "" {
			return message
		}
	}
	return ""
}

func businessCodeFailed(value any) bool {
	code := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	switch code {
	case "", "0", "200", "success", "succeeded", "ok", "<nil>":
		return false
	default:
		return true
	}
}

func normalizedUpstreamErrorCode(value any) string {
	var code string
	switch current := value.(type) {
	case string:
		code = current
	case fmt.Stringer:
		code = current.String()
	case float64:
		if current != 0 {
			code = fmt.Sprintf("%g", current)
		}
	case int:
		if current != 0 {
			code = fmt.Sprintf("%d", current)
		}
	case int64:
		if current != 0 {
			code = fmt.Sprintf("%d", current)
		}
	}
	code = strings.TrimSpace(code)
	if code == "0" {
		return ""
	}
	return truncateRunes(code, 80)
}

func stringMapField(payload map[string]any, key string) string {
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}
