package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// 主站（aicyld.com.cn）单点登录会话。
//
// 主站在登录/注册成功后下发 Domain=.aicyld.com.cn 的 cookie，值为 HS256 JWT：
//
//	{ "uid": "<主站用户ID>", "uname": "<用户名>", "name": "<昵称>", "exp": <秒级时间戳> }
//
// 画布后端只验签、不签发；密钥与主站共享（环境变量 AICYLD_SSO_SECRET）。
// Cookie 为 HttpOnly，前端 JS 读不到，只能由本后端解析。
const SSOCookieName = "aicyld_sso"

const localWorkspaceUsername = "local"

var (
	// ErrSSONotConfigured 表示未配置共享密钥，此时保持上游单工作区行为。
	ErrSSONotConfigured = errors.New("未配置 AICYLD_SSO_SECRET")
	// ErrSSOMissing 表示请求未携带主站会话 cookie。
	ErrSSOMissing = errors.New("缺少主站登录会话")
	// ErrSSOInvalid 表示会话签名或载荷不合法。
	ErrSSOInvalid = errors.New("主站登录会话无效")
	// ErrSSOExpired 表示主站会话已过期。
	ErrSSOExpired = errors.New("主站登录会话已过期")
)

// SSOIdentity 是主站身份在画布侧的投影。
type SSOIdentity struct {
	UserID      string `json:"uid"`
	Username    string `json:"uname"`
	DisplayName string `json:"name"`
	ExpiresAt   int64  `json:"exp"`
}

func ssoSecret() string {
	return strings.TrimSpace(os.Getenv("AICYLD_SSO_SECRET"))
}

// SSOConfigured 报告是否启用了主站登录集成。
func SSOConfigured() bool {
	return ssoSecret() != ""
}

// ParseSSOCookie 解析并验签主站会话 cookie。
func ParseSSOCookie(c *gin.Context) (*SSOIdentity, error) {
	secret := ssoSecret()
	if secret == "" {
		return nil, ErrSSONotConfigured
	}
	raw, err := c.Cookie(SSOCookieName)
	if err != nil {
		return nil, ErrSSOMissing
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, ErrSSOMissing
	}
	return verifySSOToken(raw, secret)
}

func verifySSOToken(token string, secret string) (*SSOIdentity, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrSSOInvalid
	}

	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrSSOInvalid
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil || header.Alg != "HS256" {
		// 只接受 HS256，避免算法混淆。
		return nil, ErrSSOInvalid
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(mac.Sum(nil), signature) {
		return nil, ErrSSOInvalid
	}

	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrSSOInvalid
	}
	var identity SSOIdentity
	if err := json.Unmarshal(payloadJSON, &identity); err != nil {
		return nil, ErrSSOInvalid
	}
	identity.UserID = strings.TrimSpace(identity.UserID)
	identity.Username = strings.TrimSpace(identity.Username)
	identity.DisplayName = strings.TrimSpace(identity.DisplayName)
	// 拒绝空身份；local 是上游内置的单机工作区账号，不能由外部令牌冒充。
	if identity.UserID == "" || identity.UserID == localWorkspaceUsername {
		return nil, ErrSSOInvalid
	}
	if identity.ExpiresAt > 0 && time.Now().Unix() > identity.ExpiresAt {
		return nil, ErrSSOExpired
	}
	return &identity, nil
}
