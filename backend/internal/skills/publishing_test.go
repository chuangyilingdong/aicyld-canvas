package skills

import (
	"testing"
	"time"
)

func TestSkillPublishingRequiresReviewAndExposesPublishedSummary(t *testing.T) {
	s, _ := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "# 分镜助手\n\n把故事拆成镜头。"})

	if _, err := s.PrepareSkillSubmission("foreign", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err == nil {
		t.Fatal("foreign author prepared a submission")
	}
	if _, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: "wrong", Confirmed: true}); err == nil {
		t.Fatal("wrong content hash was accepted")
	}
	draft, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if draft.Status != skillSubmissionDraft || draft.Revision != 1 || draft.Metadata.SkillName != "分镜助手" {
		t.Fatalf("draft = %+v", draft)
	}
	submitted, err := s.SubmitSkillSubmission("owner", draft.SubmissionID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if submitted.Status != skillSubmissionInReview {
		t.Fatalf("status = %s", submitted.Status)
	}
	if _, err := s.SkillDetail("consumer", pin.SkillID); err == nil {
		t.Fatal("pending skill leaked to consumers")
	}
	if _, err := s.SkillSubmissionReviewQueue("consumer", false, skillSubmissionInReview); err == nil {
		t.Fatal("non-admin read review queue")
	}
	if _, err := s.ReviewSkillSubmission("owner", true, draft.SubmissionID, SkillReviewRequest{Decision: "approve", Summary: passingReviewSummary()}); err == nil {
		t.Fatal("author approved their own submission")
	}
	approved, err := s.ReviewSkillSubmission("reviewer", true, draft.SubmissionID, SkillReviewRequest{Decision: "approve", Summary: passingReviewSummary()})
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != skillSubmissionPublished || approved.ReviewSummary == nil || len(approved.ReviewSummary.Trials) != 1 {
		t.Fatalf("approved = %+v", approved)
	}
	detail, err := s.SkillDetail("consumer", pin.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	owned, err := s.ownedSkill("owner", pin.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	review, err := s.PublishedSkillReview(pin.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	if owned.IsPrivate || owned.ReviewStatus != skillReviewStatusPublished || review == nil {
		t.Fatalf("published detail = %+v review=%+v", detail, review)
	}
	public, err := s.Skills("consumer", SkillListRequest{Scope: "public", PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if public.TotalCount != 1 || public.Skills[0].SkillID != pin.SkillID {
		t.Fatalf("public skills = %+v", public)
	}
}

func TestRejectedSkillCanBeRevisedAndResubmitted(t *testing.T) {
	s, db := agentSkillFixture(t)
	created, err := s.CreateSkill("owner", SkillMutationRequest{
		SkillName: "分镜助手", Description: "把故事拆成镜头。", Instruction: "# 第一版\n\n旧流程", Tag: "creative", IsPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	pin := Pin{SkillID: created.SkillID, VersionID: created.VersionID, ContentHash: created.ContentHash}
	draft, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitSkillSubmission("owner", draft.SubmissionID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewSkillSubmission("reviewer", true, draft.SubmissionID, SkillReviewRequest{Decision: "reject", Reason: "缺少失败场景"}); err != nil {
		t.Fatal(err)
	}
	skill, err := s.ownedSkill("owner", pin.SkillID)
	if err != nil {
		t.Fatal(err)
	}
	if skill.ReviewStatus != skillReviewStatusRejected || !skill.IsPrivate {
		t.Fatalf("rejected skill = %+v", skill)
	}
	updated, err := s.UpdateSkill("owner", pin.SkillID, SkillMutationRequest{
		SkillName: "分镜助手", Description: "把故事拆成镜头。", Instruction: "# 第二版\n\n补充失败场景", Tag: "creative", IsPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.VersionID == pin.VersionID {
		t.Fatal("editing did not create a new immutable version")
	}
	if _, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err == nil {
		t.Fatal("stale rejected version prepared")
	}
	next, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: updated.VersionID, ContentHash: updated.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if next.Revision != 2 {
		t.Fatalf("revision = %d", next.Revision)
	}
	if _, err := s.SubmitSkillSubmission("owner", next.SubmissionID, SkillSubmissionRequest{VersionID: updated.VersionID, ContentHash: updated.ContentHash, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	var loaded struct{ ReviewStatus string }
	if err := db.Table("skills").Select("review_status").Where("id = ?", pin.SkillID).Scan(&loaded).Error; err != nil {
		t.Fatal(err)
	}
	if loaded.ReviewStatus != skillReviewStatusInReview {
		t.Fatalf("review status = %s", loaded.ReviewStatus)
	}
}

func TestSkillWithActiveSubmissionCannotBeDeleted(t *testing.T) {
	s, _ := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "# 删除锁\n\n投稿期间不可删除。"})
	draft, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSkill("owner", pin.SkillID); err == nil {
		t.Fatal("skill with draft submission was deleted")
	}
	if _, err := s.SubmitSkillSubmission("owner", draft.SubmissionID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteSkill("owner", pin.SkillID); err == nil {
		t.Fatal("skill under review was deleted")
	}
}

func TestSkillCannotChangeWhileUnderReview(t *testing.T) {
	s, _ := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "# 审核锁\n\n当前版本"})
	draft, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitSkillSubmission("owner", draft.SubmissionID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateSkill("owner", pin.SkillID, SkillMutationRequest{
		SkillName: "审核锁", Description: "当前版本", Instruction: "# 偷换版本", Tag: "creative", IsPrivate: true,
	}); err == nil {
		t.Fatal("skill changed while under review")
	}
}

func TestRejectedZipSkillCanReplacePackageAndResubmit(t *testing.T) {
	s, _ := agentSkillFixture(t)
	pin := installAgentSkill(t, s, map[string]string{"SKILL.md": "# 包技能\n\n第一版"})
	draft, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SubmitSkillSubmission("owner", draft.SubmissionID, SkillSubmissionRequest{VersionID: pin.VersionID, ContentHash: pin.ContentHash, Confirmed: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewSkillSubmission("reviewer", true, draft.SubmissionID, SkillReviewRequest{Decision: "reject", Reason: "请更新文件"}); err != nil {
		t.Fatal(err)
	}
	updated, err := s.ReplaceSkillPackage("owner", pin.SkillID, "zip", skillUploadHeader(t, map[string]string{"SKILL.md": "# 包技能\n\n第二版"}), SkillInstallRequest{Name: "包技能", Description: "更新后的包技能", Tag: "creative"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.VersionID == pin.VersionID {
		t.Fatal("package replacement did not create a new version")
	}
	next, err := s.PrepareSkillSubmission("owner", pin.SkillID, SkillSubmissionRequest{VersionID: updated.VersionID, ContentHash: updated.ContentHash, Confirmed: true})
	if err != nil {
		t.Fatal(err)
	}
	if next.Revision != 2 {
		t.Fatalf("revision = %d", next.Revision)
	}
}

func passingReviewSummary() *SkillReviewSummaryInput {
	return &SkillReviewSummaryInput{Trials: []SkillReviewTrial{{
		Scenario: "normal", Target: "canvas", RuntimeVersion: "test", Model: "text-model",
		Conclusion: "passed", TestedAt: time.Now().UTC().Format(time.RFC3339),
	}}}
}
