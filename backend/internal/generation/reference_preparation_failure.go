package generation

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var referencePreparationCopies = map[string]struct{ reason, action string }{
	"image_reference_upload_failed": {"参考图片上传失败，本次尚未开始生成", "请稍后重试"},
	"reference_media_upload_failed": {"参考素材上传失败，本次尚未开始生成", "请检查对象存储配置和公开读取权限后重试"},
	"reference_preupload_failed":    {"参考素材上传失败，本次尚未开始生成", "请检查网络或稍后重试"},
}

var typedSubmissionStatePattern = regexp.MustCompile(`(?i)"submission_state"\s*:\s*"not_submitted"`)

// A typed gateway response can prove that its create request was refused
// before submission. The proof must include both a preparation code and an
// explicit submission_state; an echoed UI sentence alone is never enough.
func typedReferencePreparationFailure(err error) (Failure, bool) {
	body, status, requestID := "", 0, ""
	var httpErr HTTPError
	if errors.As(err, &httpErr) {
		body, status, requestID = httpErr.Body, httpErr.StatusCode, httpErr.RequestID
	} else {
		var payload PayloadError
		if errors.As(err, &payload) {
			body = firstNonEmpty(payload.raw, payload.message)
		}
	}
	fields := extractProviderFields(body)
	copy, known := referencePreparationCopies[fields.Code]
	if !known || !typedSubmissionStatePattern.MatchString(body) {
		return Failure{}, false
	}
	if status == 0 {
		status = http.StatusServiceUnavailable
	}
	return Failure{
		Category: CategoryProviderUnavailable, ProviderCode: fields.Code,
		Reason: copy.reason, Action: copy.action, RequestID: firstNonEmpty(fields.RequestID, requestID),
		HTTPStatus: status, Structured: true, FromCode: true,
	}, true
}

// Only the complete application-owned copy restores pre-submission evidence.
// A provider's upload error or a bare machine code does not prove it was unsent.
func persistedReferencePreparationFailure(raw string) (Failure, bool) {
	text := strings.TrimSpace(raw)
	requestID, taskID := persistedReferenceIDs(text)
	for code, copy := range referencePreparationCopies {
		failure := Failure{Category: CategoryProviderUnavailable, ProviderCode: code,
			Reason: copy.reason, Action: copy.action, RequestID: requestID, TaskID: taskID, FromCode: true}
		message := failure.UserMessage()
		if text == message || text == strings.TrimSuffix(message, "。") {
			return failure, true
		}
	}
	return Failure{}, false
}

// Manual retry is a deliberate new submission; preparation failures never
// authorize the automatic submission loop to send the same request again.
func (f Failure) BlocksManualRetry() bool {
	copy, ok := referencePreparationCopies[f.ProviderCode]
	if ok && !f.Uncertain && f.Category == CategoryProviderUnavailable && f.Reason == copy.reason && f.Action == copy.action {
		return false
	}
	return f.BlocksAutomaticRetry()
}
