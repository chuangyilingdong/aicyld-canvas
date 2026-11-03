package plugins

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

type memoryPublicationStore struct {
	publications map[string]*model.PluginPublication
	releases     map[string]*model.PluginRelease
}

func newMemoryPublicationStore() *memoryPublicationStore {
	return &memoryPublicationStore{publications: map[string]*model.PluginPublication{}, releases: map[string]*model.PluginRelease{}}
}

func (s *memoryPublicationStore) PluginPublication(pluginID string) (*model.PluginPublication, error) {
	item := s.publications[pluginID]
	if item == nil {
		return nil, nil
	}
	copy := *item
	return &copy, nil
}

func (s *memoryPublicationStore) PluginRelease(id string) (*model.PluginRelease, error) {
	item := s.releases[id]
	if item == nil {
		return nil, nil
	}
	copy := *item
	return &copy, nil
}

func (s *memoryPublicationStore) PluginReleaseByVersion(pluginID string, version string) (*model.PluginRelease, error) {
	for _, item := range s.releases {
		if item.PluginID == pluginID && item.Version == version {
			copy := *item
			return &copy, nil
		}
	}
	return nil, nil
}

func (s *memoryPublicationStore) PluginReleaseBySHA256(hash string) (*model.PluginRelease, error) {
	for _, item := range s.releases {
		if item.PackageSHA256 == hash {
			copy := *item
			return &copy, nil
		}
	}
	return nil, nil
}

func (s *memoryPublicationStore) PluginReleases(pluginID string) ([]model.PluginRelease, error) {
	var items []model.PluginRelease
	for _, item := range s.releases {
		if item.PluginID == pluginID {
			items = append(items, *item)
		}
	}
	return items, nil
}

func (s *memoryPublicationStore) SavePluginPublication(publication *model.PluginPublication) error {
	copy := *publication
	s.publications[publication.PluginID] = &copy
	return nil
}

func (s *memoryPublicationStore) CreatePluginRelease(release *model.PluginRelease) error {
	copy := *release
	s.releases[release.ID] = &copy
	return nil
}

func (s *memoryPublicationStore) CommitPluginPublication(publication *model.PluginPublication, release *model.PluginRelease) error {
	if release != nil {
		if err := s.CreatePluginRelease(release); err != nil {
			return err
		}
	}
	return s.SavePluginPublication(publication)
}

func (s *memoryPublicationStore) CommitPluginReleaseReview(publication *model.PluginPublication, releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error {
	release := s.releases[releaseID]
	if release == nil {
		return nil
	}
	release.ReviewStatus = status
	release.ReviewedBy = reviewerID
	release.ReviewNotes = notes
	release.ReviewedAt = &reviewedAt
	release.UpdatedAt = reviewedAt
	return s.SavePluginPublication(publication)
}

func TestReleaseServiceUploadsDraftAndReviews(t *testing.T) {
	runtime := &Runtime{packageDir: t.TempDir()}
	store := newMemoryPublicationStore()
	service := NewReleaseService(runtime, store)
	pkg := testPluginPackage(t, testManifest("official-release", "1.0.0"))

	uploaded, err := service.Upload("admin-1", pkg, UploadReleaseInput{ReleaseNotes: "首个官方版本"})
	if err != nil {
		t.Fatal(err)
	}
	if uploaded.Release.ReviewStatus != model.PluginReleaseReviewDraft || uploaded.Publication.Status != model.PluginPublicationStatusDraft {
		t.Fatalf("uploaded view = %#v", uploaded)
	}
	if uploaded.Publication.CandidateReleaseID != uploaded.Release.ID {
		t.Fatalf("candidate = %q release = %q", uploaded.Publication.CandidateReleaseID, uploaded.Release.ID)
	}
	storedPackage, err := runtime.ReleasePackage(uploaded.Release.PackageSHA256)
	if err != nil || !bytes.Equal(storedPackage, pkg) {
		t.Fatalf("stored release package mismatch err=%v", err)
	}
	if _, err := service.Upload("admin-1", pkg, UploadReleaseInput{}); err == nil || !strings.Contains(err.Error(), "版本已存在") {
		t.Fatalf("duplicate version error = %v", err)
	}

	submitted, err := service.SubmitReview("admin-1", uploaded.Release.ID)
	if err != nil {
		t.Fatal(err)
	}
	if submitted.Release.ReviewStatus != model.PluginReleaseReviewReview || submitted.Publication.Status != model.PluginPublicationStatusReview || submitted.Publication.SubmittedAt == nil {
		t.Fatalf("submitted view = %#v", submitted)
	}
	approved, err := service.Approve("reviewer-1", uploaded.Release.ID, "权限与协议校验通过")
	if err != nil {
		t.Fatal(err)
	}
	if approved.Release.ReviewStatus != model.PluginReleaseReviewApproved || approved.Release.ReviewedBy != "reviewer-1" || approved.Release.ReviewNotes == "" {
		t.Fatalf("approved view = %#v", approved)
	}
	secondPackage := testPluginPackage(t, testManifest("official-release", "2.0.0"))
	if _, err := service.Upload("admin-1", secondPackage, UploadReleaseInput{}); err == nil || !strings.Contains(err.Error(), "待处理或已通过") {
		t.Fatalf("active candidate guard error = %v", err)
	}
}

func TestReleaseServiceRejectClearsDraftCandidate(t *testing.T) {
	runtime := &Runtime{packageDir: t.TempDir()}
	store := newMemoryPublicationStore()
	service := NewReleaseService(runtime, store)
	uploaded, err := service.Upload("admin-1", testPluginPackage(t, testManifest("reject-release", "1.0.0")), UploadReleaseInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitReview("admin-1", uploaded.Release.ID); err != nil {
		t.Fatal(err)
	}
	rejected, err := service.Reject("reviewer-1", uploaded.Release.ID, "缺少权限说明")
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Release.ReviewStatus != model.PluginReleaseReviewRejected || rejected.Publication.Status != model.PluginPublicationStatusDraft || rejected.Publication.CandidateReleaseID != "" {
		t.Fatalf("rejected view = %#v", rejected)
	}
}
