package repository

import (
	"errors"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreateSkillSubmission(submission *model.SkillSubmission) error {
	return r.db.Create(submission).Error
}

func (r *Repository) CreateSkillSubmissionAndSkill(submission *model.SkillSubmission, skill *model.Skill) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(submission).Error; err != nil {
			return err
		}
		return tx.Save(skill).Error
	})
}

func (r *Repository) SkillSubmission(id string) (*model.SkillSubmission, error) {
	var submission model.SkillSubmission
	if err := r.db.First(&submission, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &submission, nil
}

func (r *Repository) SkillSubmissionsByAuthor(skillID string, authorID string) ([]model.SkillSubmission, error) {
	var submissions []model.SkillSubmission
	err := r.db.Where("skill_id = ? AND author_id = ?", skillID, authorID).
		Order("revision desc").Find(&submissions).Error
	return submissions, err
}

func (r *Repository) ActiveSkillSubmission(skillID string) (*model.SkillSubmission, error) {
	var submission model.SkillSubmission
	err := r.db.Where("skill_id = ? AND status IN ?", skillID, []string{"draft", "in_review"}).
		Order("revision desc").First(&submission).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &submission, nil
}

func (r *Repository) PublishedSkillSubmission(skillID string) (*model.SkillSubmission, error) {
	var submission model.SkillSubmission
	err := r.db.Where("skill_id = ? AND status = ?", skillID, "published").
		Order("revision desc").First(&submission).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &submission, nil
}

func (r *Repository) SkillSubmissionRevisionCount(skillID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.SkillSubmission{}).Where("skill_id = ?", skillID).Count(&count).Error
	return count, err
}

func (r *Repository) ReviewSkillSubmissions(status string) ([]model.SkillSubmission, error) {
	var submissions []model.SkillSubmission
	query := r.db.Model(&model.SkillSubmission{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	err := query.Order("submitted_at asc, created_at asc").Find(&submissions).Error
	return submissions, err
}

func (r *Repository) SaveSkillSubmission(submission *model.SkillSubmission) error {
	return r.db.Save(submission).Error
}

func (r *Repository) SaveSkillSubmissionAndSkill(submission *model.SkillSubmission, skill *model.Skill) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(submission).Error; err != nil {
			return err
		}
		return tx.Save(skill).Error
	})
}
