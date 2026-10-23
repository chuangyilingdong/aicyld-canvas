package outbound

// DNSResolutionError preserves the local resolver failure while exposing a
// stable product-facing message. Callers can classify retries without parsing
// the user-visible text.
type DNSResolutionError struct{ Cause error }

func (e *DNSResolutionError) Error() string { return "外部服务域名解析失败" }
func (e *DNSResolutionError) Unwrap() error { return e.Cause }

// BadRequestError 是出站校验失败（URL/Header 等）的稳定错误类型。
// service 层通过 aliases 转成 AppError，避免 outbound → service 回环。
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func BadAuthRequest(message string) error {
	return &BadRequestError{Message: message}
}
