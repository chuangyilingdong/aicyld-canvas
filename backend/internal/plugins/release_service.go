package plugins

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

type ReleaseView struct {
	Release     model.PluginRelease     `json:"release"`
	Publication model.PluginPublication `json:"publication"`
}

type UploadReleaseInput struct {
	ReleaseNotes string `json:"releaseNotes"`
}

type ReleaseService struct {
	runtime *Runtime
	store   PublicationStore
}

func NewReleaseService(runtime *Runtime, store PublicationStore) *ReleaseService {
	return &ReleaseService{runtime: runtime, store: store}
}

func (s *ReleaseService) Upload(actorID string, data []byte, input UploadReleaseInput) (ReleaseView, error) {
	if s == nil || s.runtime == nil || s.store == nil {
		return ReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return ReleaseView{}, kernel.Unauthorized("请先登录")
	}
	releaseNotes := strings.TrimSpace(input.ReleaseNotes)
	if len(releaseNotes) > 4000 {
		return ReleaseView{}, kernel.BadAuthRequest("发布说明不能超过 4000 字")
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		return ReleaseView{}, kernel.WrapAppError(400, "插件包校验失败", err)
	}
	pluginID := strings.TrimSpace(pkg.Manifest.Metadata.ID)
	version := strings.TrimSpace(pkg.Manifest.Metadata.Version)
	hash := pluginHash(data)
	if existing, err := s.store.PluginReleaseByVersion(pluginID, version); err != nil {
		return ReleaseView{}, err
	} else if existing != nil {
		return ReleaseView{}, kernel.NewAppError(409, "该插件版本已存在，不能重复上传")
	}
	if existing, err := s.store.PluginReleaseBySHA256(hash); err != nil {
		return ReleaseView{}, err
	} else if existing != nil {
		return ReleaseView{}, kernel.NewAppError(409, "相同插件包已经存在")
	}
	publication, err := s.store.PluginPublication(pluginID)
	if err != nil {
		return ReleaseView{}, err
	}
	now := time.Now().UTC()
	if publication == nil {
		publication = &model.PluginPublication{
			PluginID: pluginID, Status: model.PluginPublicationStatusDraft,
			CreatedBy: actorID, UpdatedBy: actorID,
			CreatedAt: now, UpdatedAt: now,
		}
	} else {
		if publication.Status == model.PluginPublicationStatusRevoked {
			return ReleaseView{}, kernel.NewAppError(409, "已撤销插件不能继续上传版本")
		}
		if err := s.ensureNoActiveCandidate(publication); err != nil {
			return ReleaseView{}, err
		}
	}
	stagedHash, err := s.runtime.StageReleasePackage(data)
	if err != nil {
		return ReleaseView{}, kernel.BadAuthRequest(err.Error())
	}
	if stagedHash != hash {
		_ = s.runtime.DiscardReleasePackage(stagedHash)
		return ReleaseView{}, fmt.Errorf("插件包哈希计算不一致")
	}
	permissionsJSON, err := json.Marshal(pkg.Manifest.Permissions)
	if err != nil {
		_ = s.runtime.DiscardReleasePackage(hash)
		return ReleaseView{}, err
	}
	contributionsJSON, err := json.Marshal(pkg.Manifest.Contributes)
	if err != nil {
		_ = s.runtime.DiscardReleasePackage(hash)
		return ReleaseView{}, err
	}
	release := &model.PluginRelease{
		ID: kernel.NewID(), PluginID: pluginID, Version: version, PackageSHA256: hash,
		ReviewStatus: model.PluginReleaseReviewDraft, ManifestJSON: string(pkg.ManifestRaw),
		PermissionsJSON: string(permissionsJSON), ContributionsJSON: string(contributionsJSON),
		HostAPIVersion: pkg.Manifest.APIVersion, ReleaseNotes: releaseNotes, CreatedBy: actorID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := ValidatePluginRelease(*release); err != nil {
		_ = s.runtime.DiscardReleasePackage(hash)
		return ReleaseView{}, kernel.WrapAppError(400, "插件版本资料无效", err)
	}
	publication.CandidateReleaseID = release.ID
	publication.UpdatedBy = actorID
	publication.UpdatedAt = now
	if err := s.store.CommitPluginPublication(publication, release); err != nil {
		if existing, lookupErr := s.store.PluginReleaseBySHA256(hash); lookupErr == nil && existing == nil {
			_ = s.runtime.DiscardReleasePackage(hash)
		}
		return ReleaseView{}, fmt.Errorf("保存插件版本：%w", err)
	}
	return ReleaseView{Release: *release, Publication: *publication}, nil
}

func (s *ReleaseService) List(pluginID string) ([]model.PluginRelease, error) {
	if s == nil || s.store == nil {
		return nil, fmt.Errorf("插件发布服务未初始化")
	}
	pluginID = strings.TrimSpace(pluginID)
	if pluginID == "" {
		return nil, kernel.BadAuthRequest("缺少插件 ID")
	}
	return s.store.PluginReleases(pluginID)
}

func (s *ReleaseService) Get(releaseID string) (ReleaseView, error) {
	release, publication, err := s.loadRelease(releaseID)
	if err != nil {
		return ReleaseView{}, err
	}
	return ReleaseView{Release: *release, Publication: *publication}, nil
}

func (s *ReleaseService) Package(releaseID string) ([]byte, *model.PluginRelease, error) {
	release, _, err := s.loadRelease(releaseID)
	if err != nil {
		return nil, nil, err
	}
	data, err := s.runtime.ReleasePackage(release.PackageSHA256)
	if err != nil {
		return nil, nil, fmt.Errorf("读取插件发布包：%w", err)
	}
	return data, release, nil
}

func (s *ReleaseService) SubmitReview(actorID string, releaseID string) (ReleaseView, error) {
	return s.transitionReview(actorID, releaseID, ReleaseReviewReview, "")
}

func (s *ReleaseService) Approve(actorID string, releaseID string, notes string) (ReleaseView, error) {
	return s.transitionReview(actorID, releaseID, ReleaseReviewApproved, notes)
}

func (s *ReleaseService) Reject(actorID string, releaseID string, notes string) (ReleaseView, error) {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ReleaseView{}, kernel.BadAuthRequest("驳回时必须填写原因")
	}
	return s.transitionReview(actorID, releaseID, ReleaseReviewRejected, notes)
}

func (s *ReleaseService) Publish(actorID string, releaseID string) (ReleaseView, error) {
	if s == nil || s.runtime == nil || s.store == nil {
		return ReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return ReleaseView{}, kernel.Unauthorized("请先登录")
	}
	release, publication, err := s.loadRelease(releaseID)
	if err != nil {
		return ReleaseView{}, err
	}
	if ReleaseReviewStatus(release.ReviewStatus) != ReleaseReviewApproved {
		return ReleaseView{}, kernel.NewAppError(409, "只有审核通过的版本才能发布")
	}
	if strings.TrimSpace(publication.CandidateReleaseID) != release.ID {
		return ReleaseView{}, kernel.NewAppError(409, "该版本已不是当前候选版本")
	}
	if publication.Status == model.PluginPublicationStatusRevoked {
		return ReleaseView{}, kernel.NewAppError(409, "已撤销插件不能重新发布")
	}
	data, err := s.runtime.ReleasePackage(release.PackageSHA256)
	if err != nil {
		return ReleaseView{}, fmt.Errorf("读取插件发布包：%w", err)
	}
	previousPublication := *publication
	var previousRelease *model.PluginRelease
	if previousID := strings.TrimSpace(publication.CurrentReleaseID); previousID != "" {
		previousRelease, err = s.store.PluginRelease(previousID)
		if err != nil {
			return ReleaseView{}, err
		}
	}
	fileName := release.PluginID + "-" + release.Version + protocol.PluginPackageExtension
	if _, err := s.runtime.PublishOfficialRelease(data, fileName, true); err != nil {
		return ReleaseView{}, fmt.Errorf("发布插件到运行态：%w", err)
	}
	now := time.Now().UTC()
	publication.Status = model.PluginPublicationStatusPublished
	publication.CurrentReleaseID = release.ID
	publication.CandidateReleaseID = ""
	publication.PublishedAt = &now
	publication.DisabledAt = nil
	publication.RevokeReason = ""
	publication.UpdatedBy = actorID
	publication.UpdatedAt = now
	if err := s.store.CommitPluginReleasePublication(publication, release.ID, actorID, now); err != nil {
		compensationErr := s.restorePreviousPublication(&previousPublication, previousRelease)
		if compensationErr != nil {
			return ReleaseView{}, fmt.Errorf("保存插件发布状态失败，运行态补偿也失败：%v；%w", compensationErr, err)
		}
		return ReleaseView{}, fmt.Errorf("保存插件发布状态：%w", err)
	}
	release.PublishedBy = actorID
	release.PublishedAt = &now
	release.UpdatedAt = now
	return ReleaseView{Release: *release, Publication: *publication}, nil
}

func (s *ReleaseService) transitionReview(actorID string, releaseID string, next ReleaseReviewStatus, notes string) (ReleaseView, error) {
	if s == nil || s.store == nil {
		return ReleaseView{}, fmt.Errorf("插件发布服务未初始化")
	}
	actorID = strings.TrimSpace(actorID)
	if actorID == "" {
		return ReleaseView{}, kernel.Unauthorized("请先登录")
	}
	notes = strings.TrimSpace(notes)
	if len(notes) > 2000 {
		return ReleaseView{}, kernel.BadAuthRequest("审核说明不能超过 2000 字")
	}
	release, publication, err := s.loadRelease(releaseID)
	if err != nil {
		return ReleaseView{}, err
	}
	from := ReleaseReviewStatus(release.ReviewStatus)
	if err := ValidateReleaseReviewTransition(from, next); err != nil {
		return ReleaseView{}, kernel.NewAppError(409, err.Error())
	}
	if strings.TrimSpace(publication.CandidateReleaseID) != release.ID {
		return ReleaseView{}, kernel.NewAppError(409, "该版本已不是当前候选版本")
	}
	now := time.Now().UTC()
	if publication.CurrentReleaseID == "" {
		switch next {
		case ReleaseReviewReview:
			publication.Status = model.PluginPublicationStatusReview
			publication.SubmittedAt = &now
		case ReleaseReviewRejected:
			publication.Status = model.PluginPublicationStatusDraft
			publication.CandidateReleaseID = ""
		}
	} else if next == ReleaseReviewRejected {
		publication.CandidateReleaseID = ""
	}
	publication.UpdatedBy = actorID
	publication.UpdatedAt = now
	if err := s.store.CommitPluginReleaseReview(publication, release.ID, string(next), actorID, notes, now); err != nil {
		return ReleaseView{}, fmt.Errorf("保存插件审核状态：%w", err)
	}
	release.ReviewStatus = string(next)
	release.ReviewNotes = notes
	release.ReviewedBy = actorID
	release.ReviewedAt = &now
	release.UpdatedAt = now
	return ReleaseView{Release: *release, Publication: *publication}, nil
}

func (s *ReleaseService) ensureNoActiveCandidate(publication *model.PluginPublication) error {
	candidateID := strings.TrimSpace(publication.CandidateReleaseID)
	if candidateID == "" {
		return nil
	}
	candidate, err := s.store.PluginRelease(candidateID)
	if err != nil {
		return err
	}
	if candidate == nil {
		return nil
	}
	switch ReleaseReviewStatus(candidate.ReviewStatus) {
	case ReleaseReviewDraft, ReleaseReviewReview, ReleaseReviewApproved:
		return kernel.NewAppError(409, "当前已有待处理或已通过但未发布的版本")
	default:
		return nil
	}
}

func (s *ReleaseService) loadRelease(releaseID string) (*model.PluginRelease, *model.PluginPublication, error) {
	if s == nil || s.store == nil {
		return nil, nil, fmt.Errorf("插件发布服务未初始化")
	}
	releaseID = strings.TrimSpace(releaseID)
	if releaseID == "" {
		return nil, nil, kernel.BadAuthRequest("缺少版本 ID")
	}
	release, err := s.store.PluginRelease(releaseID)
	if err != nil {
		return nil, nil, err
	}
	if release == nil {
		return nil, nil, kernel.NotFound("插件版本不存在")
	}
	publication, err := s.store.PluginPublication(release.PluginID)
	if err != nil {
		return nil, nil, err
	}
	if publication == nil {
		return nil, nil, kernel.NotFound("插件发布记录不存在")
	}
	return release, publication, nil
}

func (s *ReleaseService) restorePreviousPublication(publication *model.PluginPublication, release *model.PluginRelease) error {
	if publication == nil {
		return fmt.Errorf("previous publication is empty")
	}
	if release == nil {
		return s.runtime.RemoveOfficialPublished(publication.PluginID)
	}
	data, err := s.runtime.ReleasePackage(release.PackageSHA256)
	if err != nil {
		return err
	}
	enabled := publication.Status == model.PluginPublicationStatusPublished
	fileName := release.PluginID + "-" + release.Version + protocol.PluginPackageExtension
	_, err = s.runtime.PublishOfficialRelease(data, fileName, enabled)
	return err
}
