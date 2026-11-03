package plugins

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type PublicationStatus string
type ReleaseReviewStatus string

const (
	PublicationStatusDraft     PublicationStatus = model.PluginPublicationStatusDraft
	PublicationStatusReview    PublicationStatus = model.PluginPublicationStatusReview
	PublicationStatusPublished PublicationStatus = model.PluginPublicationStatusPublished
	PublicationStatusDisabled  PublicationStatus = model.PluginPublicationStatusDisabled
	PublicationStatusRevoked   PublicationStatus = model.PluginPublicationStatusRevoked
)

const (
	ReleaseReviewDraft    ReleaseReviewStatus = model.PluginReleaseReviewDraft
	ReleaseReviewReview   ReleaseReviewStatus = model.PluginReleaseReviewReview
	ReleaseReviewApproved ReleaseReviewStatus = model.PluginReleaseReviewApproved
	ReleaseReviewRejected ReleaseReviewStatus = model.PluginReleaseReviewRejected
	ReleaseReviewRevoked  ReleaseReviewStatus = model.PluginReleaseReviewRevoked
)

func ParsePublicationStatus(value string) (PublicationStatus, error) {
	status := PublicationStatus(strings.TrimSpace(value))
	if !status.Valid() {
		return "", fmt.Errorf("未知插件发布状态 %q", value)
	}
	return status, nil
}

func (status PublicationStatus) Valid() bool {
	switch status {
	case PublicationStatusDraft, PublicationStatusReview, PublicationStatusPublished, PublicationStatusDisabled, PublicationStatusRevoked:
		return true
	default:
		return false
	}
}

// CanTransitionPublication encodes the hosted publication state machine. A
// published plugin can be disabled or revoked directly; a disabled plugin can
// be republished or revoked. Revocation is terminal so a compromised package
// cannot be restored by replaying an older admin request.
func CanTransitionPublication(from PublicationStatus, to PublicationStatus) bool {
	if from == to {
		return true
	}
	switch from {
	case PublicationStatusDraft:
		return to == PublicationStatusReview
	case PublicationStatusReview:
		return to == PublicationStatusDraft || to == PublicationStatusPublished
	case PublicationStatusPublished:
		return to == PublicationStatusDisabled || to == PublicationStatusRevoked
	case PublicationStatusDisabled:
		return to == PublicationStatusPublished || to == PublicationStatusRevoked
	default:
		return false
	}
}

func ValidatePublicationTransition(from PublicationStatus, to PublicationStatus) error {
	if !from.Valid() || !to.Valid() {
		return fmt.Errorf("插件发布状态无效：%q -> %q", from, to)
	}
	if !CanTransitionPublication(from, to) {
		return fmt.Errorf("插件发布状态不能从 %s 变为 %s", from, to)
	}
	return nil
}

func ParseReleaseReviewStatus(value string) (ReleaseReviewStatus, error) {
	status := ReleaseReviewStatus(strings.TrimSpace(value))
	if !status.Valid() {
		return "", fmt.Errorf("未知插件版本审核状态 %q", value)
	}
	return status, nil
}

func (status ReleaseReviewStatus) Valid() bool {
	switch status {
	case ReleaseReviewDraft, ReleaseReviewReview, ReleaseReviewApproved, ReleaseReviewRejected, ReleaseReviewRevoked:
		return true
	default:
		return false
	}
}

func CanTransitionReleaseReview(from ReleaseReviewStatus, to ReleaseReviewStatus) bool {
	if from == to {
		return true
	}
	switch from {
	case ReleaseReviewDraft:
		return to == ReleaseReviewReview
	case ReleaseReviewReview:
		return to == ReleaseReviewApproved || to == ReleaseReviewRejected
	case ReleaseReviewApproved:
		return to == ReleaseReviewRevoked
	default:
		return false
	}
}

func ValidateReleaseReviewTransition(from ReleaseReviewStatus, to ReleaseReviewStatus) error {
	if !from.Valid() || !to.Valid() {
		return fmt.Errorf("插件版本审核状态无效：%q -> %q", from, to)
	}
	if !CanTransitionReleaseReview(from, to) {
		return fmt.Errorf("插件版本审核状态不能从 %s 变为 %s", from, to)
	}
	return nil
}

// ValidatePluginRelease verifies that the persisted release identity still
// matches the manifest that administrators reviewed. It validates package
// metadata only and never executes plugin code.
func ValidatePluginRelease(release model.PluginRelease) error {
	if strings.TrimSpace(release.ID) == "" {
		return fmt.Errorf("插件版本缺少发布记录 ID")
	}
	pluginID := strings.TrimSpace(release.PluginID)
	if pluginID == "" || pluginID != release.PluginID {
		return fmt.Errorf("插件版本 ID 无效")
	}
	version := strings.TrimSpace(release.Version)
	if version == "" || version != release.Version || len(version) > 64 || strings.IndexFunc(version, unicode.IsSpace) >= 0 || strings.ContainsAny(version, `/\`) {
		return fmt.Errorf("插件版本号无效")
	}
	if !validPackageSHA256(release.PackageSHA256) {
		return fmt.Errorf("插件包 SHA256 无效")
	}
	if !ReleaseReviewStatus(strings.TrimSpace(release.ReviewStatus)).Valid() {
		return fmt.Errorf("插件版本审核状态无效")
	}
	if strings.TrimSpace(release.ManifestJSON) == "" || !json.Valid([]byte(release.ManifestJSON)) {
		return fmt.Errorf("插件 Manifest 不是合法 JSON")
	}
	var manifest protocol.Manifest
	if err := json.Unmarshal([]byte(release.ManifestJSON), &manifest); err != nil {
		return fmt.Errorf("解析插件 Manifest：%w", err)
	}
	if err := protocol.ValidateManifest(manifest); err != nil {
		return fmt.Errorf("校验插件 Manifest：%w", err)
	}
	if manifest.Metadata.ID != pluginID {
		return fmt.Errorf("Manifest ID 与发布记录不一致")
	}
	if manifest.Metadata.Version != version {
		return fmt.Errorf("Manifest 版本与发布记录不一致")
	}
	if release.PermissionsJSON != "" && !json.Valid([]byte(release.PermissionsJSON)) {
		return fmt.Errorf("插件权限快照不是合法 JSON")
	}
	if release.ContributionsJSON != "" && !json.Valid([]byte(release.ContributionsJSON)) {
		return fmt.Errorf("插件贡献快照不是合法 JSON")
	}
	if strings.TrimSpace(release.HostAPIVersion) == "" {
		return fmt.Errorf("插件版本缺少兼容宿主 API 版本")
	}
	return nil
}
