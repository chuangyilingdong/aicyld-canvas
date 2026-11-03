package repository

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openPluginPublicationTestDB(t *testing.T) *Repository {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "publications.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PluginPublication{}, &model.PluginRelease{}); err != nil {
		t.Fatal(err)
	}
	return New(db)
}

func testPluginRelease(id, pluginID, version, packageSHA256 string) *model.PluginRelease {
	now := time.Now().UTC()
	return &model.PluginRelease{
		ID: id, PluginID: pluginID, Version: version, PackageSHA256: packageSHA256,
		ReviewStatus:   model.PluginReleaseReviewDraft,
		ManifestJSON:   `{"apiVersion":"beeftv.plugin/v1","id":"` + pluginID + `","version":"` + version + `","name":"test","contributes":{"providers":[]}}`,
		HostAPIVersion: "beeftv.plugin/v1", ReleaseNotes: "test release", CreatedBy: "admin-1",
		CreatedAt: now, UpdatedAt: now,
	}
}

func TestPluginPublicationCommitKeepsReleaseHistory(t *testing.T) {
	repo := openPluginPublicationTestDB(t)
	first := testPluginRelease("release-1", "publication-plugin", "1.0.0", strings.Repeat("a", 64))
	firstPublication := &model.PluginPublication{
		PluginID: "publication-plugin", Status: model.PluginPublicationStatusReview, CurrentReleaseID: first.ID,
		CreatedBy: "admin-1", UpdatedBy: "admin-1",
	}
	if err := repo.CommitPluginPublication(firstPublication, first); err != nil {
		t.Fatal(err)
	}
	second := testPluginRelease("release-2", "publication-plugin", "2.0.0", strings.Repeat("b", 64))
	publishedAt := time.Now().UTC()
	publishedPublication := &model.PluginPublication{
		PluginID: "publication-plugin", Status: model.PluginPublicationStatusPublished, CurrentReleaseID: second.ID,
		CreatedBy: "admin-1", UpdatedBy: "admin-2", PublishedAt: &publishedAt,
	}
	if err := repo.CommitPluginPublication(publishedPublication, second); err != nil {
		t.Fatal(err)
	}

	publication, err := repo.PluginPublication("publication-plugin")
	if err != nil || publication == nil {
		t.Fatalf("publication = %#v err=%v", publication, err)
	}
	if publication.Status != model.PluginPublicationStatusPublished || publication.CurrentReleaseID != "release-2" || publication.UpdatedBy != "admin-2" {
		t.Fatalf("unexpected publication: %#v", publication)
	}
	releases, err := repo.PluginReleases("publication-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if len(releases) != 2 || releases[0].Version != "2.0.0" || releases[1].Version != "1.0.0" {
		t.Fatalf("unexpected release history: %#v", releases)
	}
	byVersion, err := repo.PluginReleaseByVersion("publication-plugin", "1.0.0")
	if err != nil || byVersion == nil || byVersion.PackageSHA256 != strings.Repeat("a", 64) {
		t.Fatalf("release by version = %#v err=%v", byVersion, err)
	}
	bySHA, err := repo.PluginReleaseBySHA256(strings.Repeat("b", 64))
	if err != nil || bySHA == nil || bySHA.ID != "release-2" {
		t.Fatalf("release by sha = %#v err=%v", bySHA, err)
	}
}

func TestCommitPluginPublicationRollsBackReleaseOnConflict(t *testing.T) {
	repo := openPluginPublicationTestDB(t)
	first := testPluginRelease("release-1", "rollback-plugin", "1.0.0", strings.Repeat("a", 64))
	initial := &model.PluginPublication{PluginID: "rollback-plugin", Status: model.PluginPublicationStatusDraft, CurrentReleaseID: first.ID, CreatedBy: "admin-1", UpdatedBy: "admin-1"}
	if err := repo.CommitPluginPublication(initial, first); err != nil {
		t.Fatal(err)
	}
	duplicate := testPluginRelease("release-duplicate", "rollback-plugin", "1.0.0", strings.Repeat("b", 64))
	next := &model.PluginPublication{PluginID: "rollback-plugin", Status: model.PluginPublicationStatusReview, CurrentReleaseID: duplicate.ID, CreatedBy: "admin-1", UpdatedBy: "admin-2"}
	if err := repo.CommitPluginPublication(next, duplicate); err == nil {
		t.Fatal("duplicate release version committed")
	}
	publication, err := repo.PluginPublication("rollback-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if publication.Status != model.PluginPublicationStatusDraft || publication.CurrentReleaseID != "release-1" {
		t.Fatalf("publication changed after failed transaction: %#v", publication)
	}
	release, err := repo.PluginRelease("release-duplicate")
	if err != nil || release != nil {
		t.Fatalf("failed transaction persisted release: %#v err=%v", release, err)
	}
}
