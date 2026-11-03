package plugins

import (
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// PublicationStore is the durable release/review authority. It intentionally
// stays separate from Store so runtime registry persistence and publication
// lifecycle can evolve without changing every runtime test fake.
type PublicationStore interface {
	PluginPublication(pluginID string) (*model.PluginPublication, error)
	PluginRelease(id string) (*model.PluginRelease, error)
	PluginReleaseByVersion(pluginID string, version string) (*model.PluginRelease, error)
	PluginReleaseBySHA256(packageSHA256 string) (*model.PluginRelease, error)
	PluginReleases(pluginID string) ([]model.PluginRelease, error)
	SavePluginPublication(publication *model.PluginPublication) error
	CreatePluginRelease(release *model.PluginRelease) error
	CommitPluginPublication(publication *model.PluginPublication, release *model.PluginRelease) error
	CommitPluginReleaseReview(publication *model.PluginPublication, releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error
	CommitPluginReleasePublication(publication *model.PluginPublication, releaseID string, publishedBy string, publishedAt time.Time) error
}

type repositoryPublicationStore struct {
	repo *repository.Repository
}

func NewRepositoryPublicationStore(repo *repository.Repository) PublicationStore {
	if repo == nil {
		return nil
	}
	return repositoryPublicationStore{repo: repo}
}

func (s repositoryPublicationStore) PluginPublication(pluginID string) (*model.PluginPublication, error) {
	return s.repo.PluginPublication(pluginID)
}

func (s repositoryPublicationStore) PluginRelease(id string) (*model.PluginRelease, error) {
	return s.repo.PluginRelease(id)
}

func (s repositoryPublicationStore) PluginReleaseByVersion(pluginID string, version string) (*model.PluginRelease, error) {
	return s.repo.PluginReleaseByVersion(pluginID, version)
}

func (s repositoryPublicationStore) PluginReleaseBySHA256(packageSHA256 string) (*model.PluginRelease, error) {
	return s.repo.PluginReleaseBySHA256(packageSHA256)
}

func (s repositoryPublicationStore) PluginReleases(pluginID string) ([]model.PluginRelease, error) {
	return s.repo.PluginReleases(pluginID)
}

func (s repositoryPublicationStore) SavePluginPublication(publication *model.PluginPublication) error {
	return s.repo.SavePluginPublication(publication)
}

func (s repositoryPublicationStore) CreatePluginRelease(release *model.PluginRelease) error {
	return s.repo.CreatePluginRelease(release)
}

func (s repositoryPublicationStore) CommitPluginPublication(publication *model.PluginPublication, release *model.PluginRelease) error {
	return s.repo.CommitPluginPublication(publication, release)
}

func (s repositoryPublicationStore) CommitPluginReleaseReview(publication *model.PluginPublication, releaseID string, status string, reviewerID string, notes string, reviewedAt time.Time) error {
	return s.repo.CommitPluginReleaseReview(publication, releaseID, status, reviewerID, notes, reviewedAt)
}

func (s repositoryPublicationStore) CommitPluginReleasePublication(publication *model.PluginPublication, releaseID string, publishedBy string, publishedAt time.Time) error {
	return s.repo.CommitPluginReleasePublication(publication, releaseID, publishedBy, publishedAt)
}
