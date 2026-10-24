package app

import (
	"context"
	"mime/multipart"

	"infinite-canvas/backend/internal/skills"
)

const SkillPackageUploadMaxBytes = skills.SkillPackageUploadMaxBytes

type (
	SkillShowcaseMedia        = skills.SkillShowcaseMedia
	SkillEffectiveUser        = skills.SkillEffectiveUser
	SkillItem                 = skills.SkillItem
	SkillCategory             = skills.SkillCategory
	SkillListRequest          = skills.SkillListRequest
	SkillList                 = skills.SkillList
	SkillMutationRequest      = skills.SkillMutationRequest
	SkillInstallRequest       = skills.SkillInstallRequest
	SkillGitHubInstallRequest = skills.SkillGitHubInstallRequest
	SkillPackageFileItem      = skills.SkillPackageFileItem
	SkillPackageFileContent   = skills.SkillPackageFileContent
	SkillPackageBundleFile    = skills.SkillPackageBundleFile
	SkillPackageBundle        = skills.SkillPackageBundle
	SkillFileSearchResult     = skills.SkillFileSearchResult
	SkillVersionItem          = skills.SkillVersionItem
	SkillSubmissionMetadata   = skills.SkillSubmissionMetadata
	SkillSubmissionItem       = skills.SkillSubmissionItem
	SkillSubmissionRequest    = skills.SkillSubmissionRequest
	SkillReviewTrial          = skills.SkillReviewTrial
	SkillReviewSummary        = skills.SkillReviewSummary
	SkillReviewSummaryInput   = skills.SkillReviewSummaryInput
	SkillReviewRequest        = skills.SkillReviewRequest
)

func (s *Service) skillDomain() *skills.Service {
	if s == nil {
		return skills.New(nil, "", nil)
	}
	if s.skills != nil {
		return s.skills
	}
	return skills.New(s.repo, s.dataDir, s.runWorkerLoop)
}

func (s *Service) Skills(userID string, req SkillListRequest) (*SkillList, error) {
	return s.skillDomain().Skills(userID, req)
}

func (s *Service) AddedSkills(userID string) ([]SkillItem, error) {
	return s.skillDomain().AddedSkills(userID)
}

func (s *Service) SkillDetail(userID string, id string) (*SkillItem, error) {
	return s.skillDomain().SkillDetail(userID, id)
}

func (s *Service) CreateSkill(userID string, req SkillMutationRequest) (*SkillItem, error) {
	return s.skillDomain().CreateSkill(userID, req)
}

func (s *Service) UpdateSkill(userID string, id string, req SkillMutationRequest) (*SkillItem, error) {
	return s.skillDomain().UpdateSkill(userID, id, req)
}

func (s *Service) DeleteSkill(userID string, id string) error {
	return s.skillDomain().DeleteSkill(userID, id)
}

func (s *Service) SetSkillAdded(userID string, id string, added bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillAdded(userID, id, added)
}

func (s *Service) SetSkillLiked(userID string, id string, liked bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillLiked(userID, id, liked)
}

func (s *Service) SetSkillEnabled(userID string, id string, enabled bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillEnabled(userID, id, enabled)
}

func (s *Service) SkillVersions(userID string, id string) ([]SkillVersionItem, error) {
	return s.skillDomain().SkillVersions(userID, id)
}

func (s *Service) RollbackSkillVersion(userID string, id string, versionID string) (*SkillItem, error) {
	return s.skillDomain().RollbackSkillVersion(userID, id, versionID)
}

func (s *Service) CreatePrivateSkillRewrite(userID string, id string) (*SkillItem, error) {
	return s.skillDomain().CreatePrivateRewrite(userID, id)
}

func (s *Service) PrepareSkillSubmission(userID string, skillID string, req SkillSubmissionRequest) (*SkillSubmissionItem, error) {
	return s.skillDomain().PrepareSkillSubmission(userID, skillID, req)
}

func (s *Service) SubmitSkillSubmission(userID string, submissionID string, req SkillSubmissionRequest) (*SkillSubmissionItem, error) {
	return s.skillDomain().SubmitSkillSubmission(userID, submissionID, req)
}

func (s *Service) WithdrawSkillSubmission(userID string, submissionID string) (*SkillSubmissionItem, error) {
	return s.skillDomain().WithdrawSkillSubmission(userID, submissionID)
}

func (s *Service) SkillSubmissionHistory(userID string, skillID string) ([]SkillSubmissionItem, error) {
	return s.skillDomain().SkillSubmissionHistory(userID, skillID)
}

func (s *Service) SkillSubmissionReviewQueue(adminID string, isAdmin bool, status string) ([]SkillSubmissionItem, error) {
	return s.skillDomain().SkillSubmissionReviewQueue(adminID, isAdmin, status)
}

func (s *Service) ReviewSkillSubmission(adminID string, isAdmin bool, submissionID string, req SkillReviewRequest) (*SkillSubmissionItem, error) {
	return s.skillDomain().ReviewSkillSubmission(adminID, isAdmin, submissionID, req)
}

func (s *Service) SkillSubmissionFiles(adminID string, isAdmin bool, submissionID string) ([]SkillPackageFileItem, error) {
	return s.skillDomain().SkillSubmissionFiles(adminID, isAdmin, submissionID)
}

func (s *Service) SkillSubmissionFile(adminID string, isAdmin bool, submissionID string, filePath string) (*SkillPackageFileContent, error) {
	return s.skillDomain().SkillSubmissionFile(adminID, isAdmin, submissionID, filePath)
}

func (s *Service) EnsureBuiltinSkills() error {
	return s.skillDomain().EnsureBuiltinSkills()
}

func (s *Service) EnsureSkillPackages() error {
	return s.skillDomain().EnsureSkillPackages()
}

func (s *Service) InstallSkillUpload(userID string, sourceType string, header *multipart.FileHeader, req SkillInstallRequest) (*SkillItem, error) {
	return s.skillDomain().InstallSkillUpload(userID, sourceType, header, req)
}

func (s *Service) ReplaceSkillPackage(userID string, skillID string, sourceType string, header *multipart.FileHeader, req SkillInstallRequest) (*SkillItem, error) {
	return s.skillDomain().ReplaceSkillPackage(userID, skillID, sourceType, header, req)
}

func (s *Service) InstallGitHubSkill(userID string, req SkillGitHubInstallRequest) (*SkillItem, error) {
	return s.skillDomain().InstallGitHubSkill(userID, req)
}

func (s *Service) SyncGitHubSkill(userID string, skillID string) (*SkillItem, error) {
	if s.IsLocalMode() {
		return nil, BadAuthRequest("本地工作区不支持从 GitHub 同步技能")
	}
	return s.skillDomain().SyncGitHubSkill(userID, skillID)
}

func (s *Service) SkillPackageFiles(userID string, skillID string) ([]SkillPackageFileItem, error) {
	return s.skillDomain().SkillPackageFiles(userID, skillID)
}

func (s *Service) SkillPackageFile(userID string, skillID string, filePath string) (*SkillPackageFileContent, error) {
	return s.skillDomain().SkillPackageFile(userID, skillID, filePath)
}

func (s *Service) SkillPackageRawFile(userID string, skillID string, filePath string) ([]byte, string, string, error) {
	return s.skillDomain().SkillPackageRawFile(userID, skillID, filePath)
}

func (s *Service) SkillPackageBundle(userID string, skillID string) (*SkillPackageBundle, error) {
	return s.skillDomain().SkillPackageBundle(userID, skillID)
}

func (s *Service) SearchSkillPackage(userID string, skillID string, query string) ([]SkillFileSearchResult, error) {
	return s.skillDomain().SearchSkillPackage(userID, skillID, query)
}

func (s *Service) startSkillSyncWorker(ctx context.Context) {
	s.skillDomain().StartSyncWorker(ctx)
}

func (s *operationSession) DraftSkill(userID string, input skills.SkillMutationRequest) (*skills.SkillItem, error) {
	return skills.New(s.repo, s.service.dataDir, nil).CreateSkill(userID, input)
}
