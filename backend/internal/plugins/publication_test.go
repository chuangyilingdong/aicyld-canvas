package plugins

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestPublicationStatusMachine(t *testing.T) {
	tests := []struct {
		from PublicationStatus
		to   PublicationStatus
		want bool
	}{
		{PublicationStatusDraft, PublicationStatusReview, true},
		{PublicationStatusReview, PublicationStatusDraft, true},
		{PublicationStatusReview, PublicationStatusPublished, true},
		{PublicationStatusPublished, PublicationStatusDisabled, true},
		{PublicationStatusPublished, PublicationStatusRevoked, true},
		{PublicationStatusDisabled, PublicationStatusPublished, true},
		{PublicationStatusDisabled, PublicationStatusRevoked, true},
		{PublicationStatusPublished, PublicationStatusReview, false},
		{PublicationStatusRevoked, PublicationStatusPublished, false},
		{PublicationStatusDraft, PublicationStatusPublished, false},
	}
	for _, test := range tests {
		if got := CanTransitionPublication(test.from, test.to); got != test.want {
			t.Fatalf("transition %s -> %s = %v, want %v", test.from, test.to, got, test.want)
		}
	}
	if err := ValidatePublicationTransition(PublicationStatusRevoked, PublicationStatusPublished); err == nil {
		t.Fatal("revoked publication was allowed to return to published")
	}
}

func TestReleaseReviewStatusMachine(t *testing.T) {
	tests := []struct {
		from ReleaseReviewStatus
		to   ReleaseReviewStatus
		want bool
	}{
		{ReleaseReviewDraft, ReleaseReviewReview, true},
		{ReleaseReviewReview, ReleaseReviewApproved, true},
		{ReleaseReviewReview, ReleaseReviewRejected, true},
		{ReleaseReviewApproved, ReleaseReviewRevoked, true},
		{ReleaseReviewRejected, ReleaseReviewReview, false},
		{ReleaseReviewRevoked, ReleaseReviewApproved, false},
	}
	for _, test := range tests {
		if got := CanTransitionReleaseReview(test.from, test.to); got != test.want {
			t.Fatalf("review transition %s -> %s = %v, want %v", test.from, test.to, got, test.want)
		}
	}
}

func TestValidatePluginReleaseMatchesManifestIdentity(t *testing.T) {
	release := model.PluginRelease{
		ID:                "release-1",
		PluginID:          "release-test",
		Version:           "1.2.3",
		PackageSHA256:     strings.Repeat("a", 64),
		ReviewStatus:      model.PluginReleaseReviewDraft,
		ManifestJSON:      string(testManifest("release-test", "1.2.3")),
		PermissionsJSON:   `["network"]`,
		ContributionsJSON: `{"providers":[]}`,
		HostAPIVersion:    "beeftv.plugin/v1",
	}
	if err := ValidatePluginRelease(release); err != nil {
		t.Fatal(err)
	}
	release.Version = "9.9.9"
	if err := ValidatePluginRelease(release); err == nil || !strings.Contains(err.Error(), "Manifest 版本") {
		t.Fatalf("version mismatch error = %v", err)
	}
}

func TestValidatePluginReleaseRejectsInvalidPackageIdentity(t *testing.T) {
	base := model.PluginRelease{
		ID:             "release-1",
		PluginID:       "release-test",
		Version:        "1.2.3",
		PackageSHA256:  strings.Repeat("a", 64),
		ReviewStatus:   model.PluginReleaseReviewDraft,
		ManifestJSON:   string(testManifest("release-test", "1.2.3")),
		HostAPIVersion: "beeftv.plugin/v1",
	}
	for name, mutate := range map[string]func(*model.PluginRelease){
		"bad hash":          func(release *model.PluginRelease) { release.PackageSHA256 = "not-a-hash" },
		"bad json":          func(release *model.PluginRelease) { release.ManifestJSON = "{" },
		"bad permissions":   func(release *model.PluginRelease) { release.PermissionsJSON = "{" },
		"missing host api":  func(release *model.PluginRelease) { release.HostAPIVersion = "" },
		"bad review status": func(release *model.PluginRelease) { release.ReviewStatus = "unknown" },
	} {
		t.Run(name, func(t *testing.T) {
			release := base
			mutate(&release)
			if err := ValidatePluginRelease(release); err == nil {
				t.Fatal("invalid release accepted")
			}
		})
	}
}
