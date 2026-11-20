package database

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func migrateSmartFilmAtomicBudgetLedger(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.SmartFilmBatch{}); err != nil {
		return err
	}
	hasBillingPoints, err := sqliteHasColumn(tx, "tasks", "billing_points")
	if err != nil {
		return err
	}
	hasBillingStatus, err := sqliteHasColumn(tx, "tasks", "billing_status")
	if err != nil {
		return err
	}
	if !hasBillingPoints || !hasBillingStatus {
		return nil
	}
	return tx.Exec(`UPDATE smart_film_batches AS batch SET budget_used_points = COALESCE((
		SELECT SUM(task.billing_points)
		FROM tasks AS task
		WHERE task.user_id = batch.user_id
			AND task.billing_points > 0
			AND task.billing_status <> 'refunded'
			AND (
				EXISTS (
					SELECT 1 FROM projects AS project
					WHERE project.id = task.project_id
						AND project.user_id = task.user_id
						AND project.batch_id = batch.id
				)
				OR (
					json_valid(task.input_json)
					AND json_extract(task.input_json, '$.metadata.batchId') = batch.id
				)
			)
	), 0)`).Error
}
