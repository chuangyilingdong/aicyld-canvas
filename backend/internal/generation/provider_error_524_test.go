package generation_test

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/generation"
)

func TestHTTP524RequiresManualVerificationBeforeResubmission(t *testing.T) {
	failure := generation.ClassifyHTTP(524, "524 A Timeout Occurred", "<html>524</html>")
	if failure.Category != generation.CategoryTimeout || failure.HTTPStatus != 524 {
		t.Fatalf("unexpected classification: %+v", failure)
	}
	if !failure.Uncertain || failure.Retryable {
		t.Fatalf("524 must remain uncertain and non-retryable: %+v", failure)
	}
	if !failure.BlocksAutomaticRetry() || !failure.BlocksManualRetry() {
		t.Fatalf("524 must block both automatic and manual replay: %+v", failure)
	}
	if !strings.Contains(failure.Reason, "HTTP 524") || !strings.Contains(failure.Action, "不要立即重新提交") {
		t.Fatalf("524 guidance lost upstream timeout context: %+v", failure)
	}
}

func TestPersistedHTTP524RemainsBlockedAfterReload(t *testing.T) {
	failure := generation.ClassifyText("上游网关响应超时（HTTP 524），请求可能仍在服务端执行。请先到供应商或中转后台核对状态，不要立即重新提交；若频繁超时，请检查中转网关超时或连接保活（keep-alive）配置，确认未出图后再重新生成。")
	if failure.Category != generation.CategoryTimeout || !failure.Uncertain || failure.Retryable {
		t.Fatalf("persisted 524 must stay uncertain and non-retryable: %+v", failure)
	}
	if !failure.BlocksAutomaticRetry() || !failure.BlocksManualRetry() {
		t.Fatalf("persisted 524 must block replay: %+v", failure)
	}
}
