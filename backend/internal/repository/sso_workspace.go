package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// SSOWorkspacePrefix 标记由主站登录创建的工作区，便于与内置本地工作区区分。
const SSOWorkspacePrefix = "sso_"

// SSOWorkspaceID 由主站用户 ID 推导出画布工作区 ID。
//
// 开源版没有 users 表：一个「用户」就是 workspaces 表的一行（由 LocalPrincipal 投影）。
// 因此多租户 = 每个主站用户一行工作区，所有业务表按 user_id（= 工作区 ID）隔离。
func SSOWorkspaceID(mainSiteUserID string) string {
	id := strings.TrimSpace(mainSiteUserID)
	candidate := SSOWorkspacePrefix + id
	if len(candidate) <= 36 {
		return candidate
	}
	// 极端情况下（上游 ID 变长）退化为稳定哈希，保证不超过列宽 36。
	sum := sha256.Sum256([]byte(id))
	return SSOWorkspacePrefix + hex.EncodeToString(sum[:])[:32]
}

// EnsureWorkspace 幂等确保主站身份对应的工作区存在。
func (r *Repository) EnsureWorkspace(mainSiteUserID string, name string) (*model.Workspace, error) {
	workspaceID := SSOWorkspaceID(mainSiteUserID)
	if err := validateWorkspaceID(workspaceID); err != nil {
		return nil, err
	}

	existing, err := r.Workspace(workspaceID)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	displayName := strings.TrimSpace(name)
	if displayName == "" {
		displayName = mainSiteUserID
	}
	if len([]rune(displayName)) > 80 {
		displayName = string([]rune(displayName)[:80])
	}

	now := time.Now().UTC()
	value := model.Workspace{ID: workspaceID, Name: displayName, CreatedAt: now, UpdatedAt: now}
	if err := r.db.Create(&value).Error; err != nil {
		// 并发首登可能已被其它请求创建，读回即可。
		if reread, readErr := r.Workspace(workspaceID); readErr == nil {
			return reread, nil
		}
		return nil, err
	}
	return &value, nil
}

func validateWorkspaceID(id string) error {
	if id == "" {
		return errors.New("工作区 ID 不能为空")
	}
	if len(id) > 36 {
		return errors.New("工作区 ID 超出列宽限制")
	}
	return nil
}
