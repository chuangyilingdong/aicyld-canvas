package skills

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	skillReviewStatusDraft     = "draft"
	skillReviewStatusPending   = "pending"
	skillReviewStatusInReview  = "in_review"
	skillReviewStatusRejected  = "rejected"
	skillReviewStatusPublished = "published"

	skillSubmissionDraft     = "draft"
	skillSubmissionInReview  = "in_review"
	skillSubmissionRejected  = "rejected"
	skillSubmissionPublished = "published"
	skillSubmissionWithdrawn = "withdrawn"
)

type SkillSubmissionMetadata struct {
	SkillName     string               `json:"skillName"`
	Description   string               `json:"description"`
	Tag           string               `json:"tag"`
	VersionLabel  string               `json:"versionLabel"`
	MarkdownURL   string               `json:"markdownUrl"`
	ExtraInfo     string               `json:"extraInfo"`
	ShowcaseMedia []SkillShowcaseMedia `json:"showcaseMedia"`
}

type SkillReviewTrial struct {
	Scenario       string `json:"scenario"`
	Target         string `json:"target"`
	RuntimeVersion string `json:"runtimeVersion"`
	Model          string `json:"model"`
	Conclusion     string `json:"conclusion"`
	TestedAt       string `json:"testedAt"`
}

type SkillReviewSummary struct {
	ReviewedAt  string             `json:"reviewedAt"`
	Revision    int64              `json:"revision"`
	ContentHash string             `json:"contentHash"`
	Trials      []SkillReviewTrial `json:"trials"`
}

type SkillReviewSummaryInput struct {
	Trials []SkillReviewTrial `json:"trials"`
}

type SkillSubmissionItem struct {
	SubmissionID  string                  `json:"submissionId"`
	SkillID       string                  `json:"skillId"`
	VersionID     string                  `json:"versionId"`
	AuthorID      string                  `json:"authorId"`
	Revision      int64                   `json:"revision"`
	Status        string                  `json:"status"`
	ContentHash   string                  `json:"contentHash"`
	Metadata      SkillSubmissionMetadata `json:"metadata"`
	ReviewReason  string                  `json:"reviewReason,omitempty"`
	ReviewSummary *SkillReviewSummary     `json:"reviewSummary,omitempty"`
	SubmittedAt   *time.Time              `json:"submittedAt,omitempty"`
	ReviewedAt    *time.Time              `json:"reviewedAt,omitempty"`
	PublishedAt   *time.Time              `json:"publishedAt,omitempty"`
	CreatedAt     time.Time               `json:"createdAt"`
	UpdatedAt     time.Time               `json:"updatedAt"`
}

type SkillSubmissionRequest struct {
	VersionID   string `json:"versionId"`
	ContentHash string `json:"contentHash"`
	Confirmed   bool   `json:"confirmed"`
}

type SkillReviewRequest struct {
	Decision string                   `json:"decision"`
	Reason   string                   `json:"reason"`
	Summary  *SkillReviewSummaryInput `json:"summary,omitempty"`
}

func (s *Service) PrepareSkillSubmission(authorID string, skillID string, req SkillSubmissionRequest) (*SkillSubmissionItem, error) {
	if !req.Confirmed {
		return nil, kernel.BadAuthRequest("请先确认本次投稿的版本和文件")
	}
	skill, err := s.ownedSkill(authorID, skillID)
	if err != nil {
		return nil, err
	}
	if skill.Source != skillSourceUser {
		return nil, kernel.BadAuthRequest("只有用户创建的技能可以投稿")
	}
	version, err := s.repo.SkillVersion(strings.TrimSpace(req.VersionID))
	if err != nil || version.SkillID != skill.ID || version.ID != skill.CurrentVersionID {
		return nil, kernel.BadAuthRequest("投稿版本不是该技能当前版本，请刷新后重试")
	}
	if strings.TrimSpace(req.ContentHash) != skill.ContentHash || version.ContentHash != skill.ContentHash {
		return nil, kernel.NewAppError(409, "技能文件已变化，请刷新文件摘要后重新确认")
	}
	active, err := s.repo.ActiveSkillSubmission(skill.ID)
	if err != nil {
		return nil, err
	}
	if active != nil && active.Status == skillSubmissionInReview {
		return nil, kernel.NewAppError(409, "该技能正在审核，请等待审核结果")
	}
	metadata, err := submissionMetadata(skill)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return nil, err
	}
	if active != nil && active.Status == skillSubmissionDraft && active.VersionID == version.ID && active.ContentHash == version.ContentHash {
		active.MetadataJSON = string(encoded)
		if err := s.repo.SaveSkillSubmission(active); err != nil {
			return nil, err
		}
		return s.skillSubmissionItem(active)
	}
	if active != nil && active.Status == skillSubmissionDraft {
		active.Status = skillSubmissionWithdrawn
		if err := s.repo.SaveSkillSubmission(active); err != nil {
			return nil, err
		}
	}
	revision, err := s.repo.SkillSubmissionRevisionCount(skill.ID)
	if err != nil {
		return nil, err
	}
	submission := &model.SkillSubmission{
		ID: kernel.NewID(), AuthorID: authorID, SkillID: skill.ID, VersionID: version.ID,
		Revision: revision + 1, Status: skillSubmissionDraft, ContentHash: version.ContentHash, MetadataJSON: string(encoded),
	}
	skill.ReviewStatus = skillReviewStatusDraft
	skill.IsPrivate = true
	if err := s.repo.CreateSkillSubmissionAndSkill(submission, skill); err != nil {
		return nil, err
	}
	return s.skillSubmissionItem(submission)
}

func (s *Service) SubmitSkillSubmission(authorID string, submissionID string, req SkillSubmissionRequest) (*SkillSubmissionItem, error) {
	if !req.Confirmed {
		return nil, kernel.BadAuthRequest("请先确认本次公开预览")
	}
	submission, err := s.ownedSkillSubmission(authorID, submissionID)
	if err != nil {
		return nil, err
	}
	if submission.Status != skillSubmissionDraft {
		return nil, kernel.NewAppError(409, "只有投稿草稿可以送审")
	}
	skill, err := s.ownedSkill(authorID, submission.SkillID)
	if err != nil {
		return nil, err
	}
	if skill.CurrentVersionID != submission.VersionID || skill.ContentHash != submission.ContentHash || req.VersionID != submission.VersionID || req.ContentHash != submission.ContentHash {
		return nil, kernel.NewAppError(409, "技能文件在确认后发生变化，请重新准备投稿")
	}
	active, err := s.repo.ActiveSkillSubmission(skill.ID)
	if err != nil {
		return nil, err
	}
	if active != nil && active.ID != submission.ID && active.Status == skillSubmissionInReview {
		return nil, kernel.NewAppError(409, "该技能已有待审核投稿")
	}
	now := time.Now()
	submission.Status = skillSubmissionInReview
	submission.SubmittedAt = &now
	skill.ReviewStatus = skillReviewStatusInReview
	skill.IsPrivate = true
	if err := s.repo.SaveSkillSubmissionAndSkill(submission, skill); err != nil {
		return nil, err
	}
	return s.skillSubmissionItem(submission)
}

func (s *Service) WithdrawSkillSubmission(authorID string, submissionID string) (*SkillSubmissionItem, error) {
	submission, err := s.ownedSkillSubmission(authorID, submissionID)
	if err != nil {
		return nil, err
	}
	if submission.Status != skillSubmissionDraft {
		return nil, kernel.NewAppError(409, "只有投稿草稿可以撤回")
	}
	skill, err := s.ownedSkill(authorID, submission.SkillID)
	if err != nil {
		return nil, err
	}
	submission.Status = skillSubmissionWithdrawn
	skill.ReviewStatus = skillReviewStatusDraft
	skill.IsPrivate = true
	if err := s.repo.SaveSkillSubmissionAndSkill(submission, skill); err != nil {
		return nil, err
	}
	return s.skillSubmissionItem(submission)
}

func (s *Service) SkillSubmissionHistory(authorID string, skillID string) ([]SkillSubmissionItem, error) {
	if _, err := s.ownedSkill(authorID, skillID); err != nil {
		return nil, err
	}
	rows, err := s.repo.SkillSubmissionsByAuthor(skillID, authorID)
	if err != nil {
		return nil, err
	}
	items := make([]SkillSubmissionItem, 0, len(rows))
	for index := range rows {
		item, err := s.skillSubmissionItem(&rows[index])
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, nil
}

func (s *Service) SkillSubmissionReviewQueue(adminID string, isAdmin bool, status string) ([]SkillSubmissionItem, error) {
	if !isAdmin || strings.TrimSpace(adminID) == "" {
		return nil, kernel.Forbidden("只有审核员可以查看投稿队列")
	}
	status = strings.TrimSpace(status)
	if status == "" {
		status = skillSubmissionInReview
	}
	if status != skillSubmissionInReview && status != skillSubmissionRejected && status != skillSubmissionPublished {
		return nil, kernel.BadAuthRequest("审核状态无效")
	}
	rows, err := s.repo.ReviewSkillSubmissions(status)
	if err != nil {
		return nil, err
	}
	items := make([]SkillSubmissionItem, 0, len(rows))
	for index := range rows {
		item, err := s.skillSubmissionItem(&rows[index])
		if err != nil {
			return nil, err
		}
		items = append(items, *item)
	}
	return items, nil
}

func (s *Service) ReviewSkillSubmission(adminID string, isAdmin bool, submissionID string, req SkillReviewRequest) (*SkillSubmissionItem, error) {
	if !isAdmin || strings.TrimSpace(adminID) == "" {
		return nil, kernel.Forbidden("只有审核员可以处理投稿")
	}
	submission, err := s.repo.SkillSubmission(strings.TrimSpace(submissionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("投稿不存在")
	}
	if err != nil {
		return nil, err
	}
	if submission.Status != skillSubmissionInReview {
		return nil, kernel.NewAppError(409, "该投稿不在待审核状态")
	}
	if submission.AuthorID == adminID {
		return nil, kernel.Forbidden("作者不能审核自己的投稿")
	}
	skill, err := s.repo.Skill(submission.SkillID)
	if err != nil {
		return nil, err
	}
	if skill.OwnerID != submission.AuthorID || skill.CurrentVersionID != submission.VersionID || skill.ContentHash != submission.ContentHash {
		return nil, kernel.NewAppError(409, "投稿版本与当前技能不一致，请退回作者重新投稿")
	}
	version, err := s.repo.SkillVersion(submission.VersionID)
	if err != nil || version.SkillID != skill.ID || version.ContentHash != submission.ContentHash {
		return nil, kernel.NewAppError(409, "投稿版本不存在或摘要不一致")
	}
	reason := strings.TrimSpace(req.Reason)
	if utf8.RuneCountInString(reason) > 4000 {
		return nil, kernel.BadAuthRequest("审核意见不能超过 4000 个字符")
	}
	now := time.Now()
	submission.ReviewerID = adminID
	submission.ReviewedAt = &now
	submission.ReviewReason = reason
	switch strings.TrimSpace(req.Decision) {
	case "approve":
		summary, encoded, err := normalizeSkillReviewSummary(req.Summary, submission.Revision, submission.ContentHash, now)
		if err != nil {
			return nil, err
		}
		_ = summary
		submission.Status = skillSubmissionPublished
		submission.ReviewSummaryJSON = encoded
		submission.PublishedAt = &now
		skill.ReviewStatus = skillReviewStatusPublished
		skill.IsPrivate = false
	case "reject":
		if reason == "" {
			return nil, kernel.BadAuthRequest("退回投稿时必须填写审核意见")
		}
		submission.Status = skillSubmissionRejected
		if req.Summary != nil {
			_, encoded, err := normalizeSkillReviewSummary(req.Summary, submission.Revision, submission.ContentHash, now)
			if err != nil {
				return nil, err
			}
			submission.ReviewSummaryJSON = encoded
		}
		skill.ReviewStatus = skillReviewStatusRejected
		skill.IsPrivate = true
	default:
		return nil, kernel.BadAuthRequest("审核结论必须是 approve 或 reject")
	}
	if err := s.repo.SaveSkillSubmissionAndSkill(submission, skill); err != nil {
		return nil, err
	}
	return s.skillSubmissionItem(submission)
}

func (s *Service) SkillSubmissionFiles(adminID string, isAdmin bool, submissionID string) ([]SkillPackageFileItem, error) {
	_, version, _, err := s.reviewSubmissionPackage(adminID, isAdmin, submissionID)
	if err != nil {
		return nil, err
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, err
	}
	items := make([]SkillPackageFileItem, 0, len(files))
	for _, file := range files {
		items = append(items, skillFileItem(file))
	}
	return items, nil
}

func (s *Service) SkillSubmissionFile(adminID string, isAdmin bool, submissionID string, filePath string) (*SkillPackageFileContent, error) {
	_, version, files, err := s.reviewSubmissionPackage(adminID, isAdmin, submissionID)
	if err != nil {
		return nil, err
	}
	var selected *model.SkillFile
	for index := range files {
		if files[index].Path == filePath {
			selected = &files[index]
			break
		}
	}
	if selected == nil {
		return nil, kernel.BadAuthRequest("技能文件不存在")
	}
	content, err := s.readSkillArchiveEntry(version, selected.Path)
	if err != nil {
		return nil, err
	}
	binary := !isPreviewText(selected.MimeType, selected.Path)
	text := ""
	if !binary {
		text = truncateUTF8(string(content), maxSkillPreviewBytes)
	}
	return &SkillPackageFileContent{File: skillFileItem(*selected), Content: text, Binary: binary}, nil
}

func (s *Service) PublishedSkillReview(skillID string) (*SkillReviewSummary, error) {
	submission, err := s.repo.PublishedSkillSubmission(skillID)
	if err != nil || submission == nil || strings.TrimSpace(submission.ReviewSummaryJSON) == "" {
		return nil, err
	}
	var summary SkillReviewSummary
	if err := json.Unmarshal([]byte(submission.ReviewSummaryJSON), &summary); err != nil {
		return nil, err
	}
	return &summary, nil
}

func (s *Service) ownedSkillSubmission(authorID string, submissionID string) (*model.SkillSubmission, error) {
	submission, err := s.repo.SkillSubmission(strings.TrimSpace(submissionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("投稿不存在")
	}
	if err != nil {
		return nil, err
	}
	if submission.AuthorID != authorID {
		return nil, kernel.Forbidden("只有投稿作者可以操作该稿件")
	}
	return submission, nil
}

func (s *Service) reviewSubmissionPackage(adminID string, isAdmin bool, submissionID string) (*model.SkillSubmission, *model.SkillVersion, []model.SkillFile, error) {
	if !isAdmin || strings.TrimSpace(adminID) == "" {
		return nil, nil, nil, kernel.Forbidden("只有审核员可以查看投稿文件")
	}
	submission, err := s.repo.SkillSubmission(strings.TrimSpace(submissionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, nil, kernel.BadAuthRequest("投稿不存在")
	}
	if err != nil {
		return nil, nil, nil, err
	}
	version, err := s.repo.SkillVersion(submission.VersionID)
	if err != nil || version.SkillID != submission.SkillID || version.ContentHash != submission.ContentHash {
		return nil, nil, nil, kernel.NewAppError(409, "投稿版本不存在或摘要不一致")
	}
	files, err := s.repo.SkillFiles(version.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	return submission, version, files, nil
}

func (s *Service) skillSubmissionItem(submission *model.SkillSubmission) (*SkillSubmissionItem, error) {
	var metadata SkillSubmissionMetadata
	if err := json.Unmarshal([]byte(submission.MetadataJSON), &metadata); err != nil {
		return nil, err
	}
	var summary *SkillReviewSummary
	if strings.TrimSpace(submission.ReviewSummaryJSON) != "" {
		summary = &SkillReviewSummary{}
		if err := json.Unmarshal([]byte(submission.ReviewSummaryJSON), summary); err != nil {
			return nil, err
		}
	}
	return &SkillSubmissionItem{
		SubmissionID: submission.ID, SkillID: submission.SkillID, VersionID: submission.VersionID, AuthorID: submission.AuthorID,
		Revision: submission.Revision, Status: submission.Status, ContentHash: submission.ContentHash, Metadata: metadata,
		ReviewReason: submission.ReviewReason, ReviewSummary: summary, SubmittedAt: submission.SubmittedAt, ReviewedAt: submission.ReviewedAt,
		PublishedAt: submission.PublishedAt, CreatedAt: submission.CreatedAt, UpdatedAt: submission.UpdatedAt,
	}, nil
}

func submissionMetadata(skill *model.Skill) (SkillSubmissionMetadata, error) {
	media, err := parseShowcaseMedia(skill.ShowcaseMediaJSON)
	if err != nil {
		return SkillSubmissionMetadata{}, err
	}
	return SkillSubmissionMetadata{
		SkillName: skill.Name, Description: skill.Description, Tag: skill.Tag, VersionLabel: skill.VersionLabel,
		MarkdownURL: skill.MarkdownURL, ExtraInfo: skill.ExtraInfo, ShowcaseMedia: media,
	}, nil
}

func normalizeSkillReviewSummary(input *SkillReviewSummaryInput, revision int64, contentHash string, reviewedAt time.Time) (SkillReviewSummary, string, error) {
	if input == nil || len(input.Trials) == 0 {
		return SkillReviewSummary{}, "", kernel.BadAuthRequest("审核通过前至少填写一条实测记录")
	}
	if len(input.Trials) > 20 {
		return SkillReviewSummary{}, "", kernel.BadAuthRequest("实测记录最多 20 条")
	}
	trials := make([]SkillReviewTrial, 0, len(input.Trials))
	for _, raw := range input.Trials {
		trial := SkillReviewTrial{
			Scenario: strings.TrimSpace(raw.Scenario), Target: strings.TrimSpace(raw.Target),
			RuntimeVersion: strings.TrimSpace(raw.RuntimeVersion), Model: strings.TrimSpace(raw.Model),
			Conclusion: strings.TrimSpace(raw.Conclusion), TestedAt: strings.TrimSpace(raw.TestedAt),
		}
		if trial.Scenario == "" || trial.Target == "" || trial.RuntimeVersion == "" || trial.Model == "" || trial.Conclusion == "" || trial.TestedAt == "" {
			return SkillReviewSummary{}, "", kernel.BadAuthRequest("实测记录字段不完整")
		}
		if trial.Conclusion != "passed" && trial.Conclusion != "failed" {
			return SkillReviewSummary{}, "", kernel.BadAuthRequest("实测结论只接受 passed 或 failed")
		}
		if trial.Conclusion != "passed" {
			return SkillReviewSummary{}, "", kernel.BadAuthRequest("存在未通过的实测记录，不能审核通过")
		}
		if _, err := time.Parse(time.RFC3339, trial.TestedAt); err != nil {
			return SkillReviewSummary{}, "", kernel.BadAuthRequest("实测时间必须是 RFC3339 格式")
		}
		trials = append(trials, trial)
	}
	summary := SkillReviewSummary{ReviewedAt: reviewedAt.UTC().Format(time.RFC3339), Revision: revision, ContentHash: contentHash, Trials: trials}
	encoded, err := json.Marshal(summary)
	if err != nil {
		return SkillReviewSummary{}, "", err
	}
	return summary, string(encoded), nil
}

func truncateUTF8(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	for maxBytes > 0 && maxBytes < len(value) && value[maxBytes]&0xC0 == 0x80 {
		maxBytes--
	}
	return value[:maxBytes]
}
