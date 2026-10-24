package repository

import "infinite-canvas/backend/internal/model"

func (r *Repository) SkillVersions(skillID string) ([]model.SkillVersion, error) {
	var rows []model.SkillVersion
	err := r.db.Where("skill_id = ?", skillID).Order("created_at desc").Find(&rows).Error
	return rows, err
}
