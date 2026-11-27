package asset

import (
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type gormRepository struct {
	*repository.Repository
}

// NewRepository adapts the GORM resource store to the domain port.
func NewRepository(repo *repository.Repository) Repository {
	if repo == nil {
		return nil
	}
	return gormRepository{Repository: repo}
}

func (r gormRepository) NextResourceDeletionWakeAt() (*time.Time, error) {
	return nil, nil
}
func (r gormRepository) SaveResources(resources []*model.Resource) error {
	return r.DB().Transaction(func(tx *gorm.DB) error {
		bound := r.Repository.WithTx(tx)
		for _, resource := range resources {
			if resource == nil {
				continue
			}
			if err := bound.SaveResource(resource); err != nil {
				return err
			}
		}
		return nil
	})
}
