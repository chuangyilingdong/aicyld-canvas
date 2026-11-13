package database

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

const CurrentAICYLDOverlaySchemaVersion int64 = 1

type aicyldOverlayMigration struct {
	Version   int64 `gorm:"primaryKey;autoIncrement:false"`
	Name      string
	AppliedAt time.Time
}

func (aicyldOverlayMigration) TableName() string { return "aicyld_schema_migrations" }

type aicyldOverlayMigrationStep struct {
	version int64
	name    string
	apply   func(*gorm.DB) error
}

type AICYLDOverlaySchemaStatus struct {
	Current  int64 `json:"current"`
	Expected int64 `json:"expected"`
	Ready    bool  `json:"ready"`
}

func canonicalAICYLDOverlayMigrations() []aicyldOverlayMigrationStep {
	return []aicyldOverlayMigrationStep{
		{version: 1, name: "hosted-billing-task-fields", apply: migrateAICYLDHostedBillingTaskFields},
	}
}

// MigrateAICYLDOverlaySchema applies AICYLD-owned schema changes after the
// upstream ledger is current. Keeping a separate ledger prevents hosted fields
// from colliding with future BeefTV migration versions.
func MigrateAICYLDOverlaySchema(db *gorm.DB) error {
	if err := RequireLocalSchema(db); err != nil {
		return fmt.Errorf("AICYLD overlay 需要先完成上游数据库迁移: %w", err)
	}
	if err := db.AutoMigrate(&aicyldOverlayMigration{}); err != nil {
		return fmt.Errorf("初始化 AICYLD overlay 迁移账本: %w", err)
	}
	current, err := currentAICYLDOverlaySchemaVersion(db)
	if err != nil {
		return err
	}
	if current > CurrentAICYLDOverlaySchemaVersion {
		return fmt.Errorf("AICYLD overlay 数据库版本 %d 高于当前程序支持的 %d，拒绝降级迁移", current, CurrentAICYLDOverlaySchemaVersion)
	}
	frozen, err := listAICYLDOverlayMigrations(db)
	if err != nil {
		return err
	}
	occupied := make(map[int64]aicyldOverlayMigration, len(frozen))
	for _, row := range frozen {
		occupied[row.Version] = row
	}
	for _, migration := range canonicalAICYLDOverlayMigrations() {
		if _, exists := occupied[migration.version]; exists {
			continue
		}
		if migration.version <= current {
			continue
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := migration.apply(tx); err != nil {
				return err
			}
			if err := tx.Create(&aicyldOverlayMigration{
				Version:   migration.version,
				Name:      migration.name,
				AppliedAt: time.Now().UTC(),
			}).Error; err != nil {
				return err
			}
			return assertAICYLDOverlayLedgerImmutable(tx, frozen)
		}); err != nil {
			return fmt.Errorf("执行 AICYLD overlay 迁移 v%d %s: %w", migration.version, migration.name, err)
		}
		frozen, err = listAICYLDOverlayMigrations(db)
		if err != nil {
			return err
		}
		current = migration.version
	}
	if err := assertAICYLDOverlayLedgerImmutable(db, frozen); err != nil {
		return err
	}
	return RequireAICYLDOverlaySchema(db)
}

func RequireAICYLDOverlaySchema(db *gorm.DB) error {
	status, err := ReadAICYLDOverlaySchemaStatus(db)
	if err != nil {
		return err
	}
	if !status.Ready {
		return fmt.Errorf("AICYLD overlay 数据库未就绪: current=%d expected=%d", status.Current, status.Expected)
	}
	return nil
}

func ReadAICYLDOverlaySchemaStatus(db *gorm.DB) (AICYLDOverlaySchemaStatus, error) {
	status := AICYLDOverlaySchemaStatus{Expected: CurrentAICYLDOverlaySchemaVersion}
	if !hasAICYLDOverlaySchemaLedger(db) {
		return status, nil
	}
	current, err := currentAICYLDOverlaySchemaVersion(db)
	if err != nil {
		return status, err
	}
	status.Current = current
	if current != CurrentAICYLDOverlaySchemaVersion {
		return status, nil
	}
	if err := requireAICYLDHostedBillingTaskSchema(db); err != nil {
		return status, err
	}
	status.Ready = true
	return status, nil
}

func migrateAICYLDHostedBillingTaskFields(tx *gorm.DB) error {
	for _, column := range []struct {
		name       string
		definition string
	}{
		{name: "billing_hold_id", definition: "TEXT"},
		{name: "billing_status", definition: "TEXT"},
		{name: "billing_points", definition: "INTEGER NOT NULL DEFAULT 0"},
	} {
		if err := ensureSQLiteColumn(tx, "tasks", column.name, column.definition); err != nil {
			return err
		}
	}
	return ensureSQLiteIndex(tx, "tasks", "idx_tasks_billing_hold_id",
		"CREATE INDEX idx_tasks_billing_hold_id ON tasks(billing_hold_id)")
}

func requireAICYLDHostedBillingTaskSchema(db *gorm.DB) error {
	for _, column := range []string{"billing_hold_id", "billing_status", "billing_points"} {
		has, err := sqliteHasColumn(db, "tasks", column)
		if err != nil {
			return err
		}
		if !has {
			return fmt.Errorf("AICYLD 托管计费字段 tasks.%s 缺失", column)
		}
	}
	has, err := sqliteHasNamedIndex(db, "tasks", "idx_tasks_billing_hold_id")
	if err != nil {
		return err
	}
	if !has {
		return fmt.Errorf("AICYLD 托管计费索引 idx_tasks_billing_hold_id 缺失")
	}
	return nil
}

func currentAICYLDOverlaySchemaVersion(db *gorm.DB) (int64, error) {
	if !hasAICYLDOverlaySchemaLedger(db) {
		return 0, nil
	}
	var version int64
	if err := db.Model(&aicyldOverlayMigration{}).Select("COALESCE(MAX(version), 0)").Scan(&version).Error; err != nil {
		return 0, fmt.Errorf("读取 AICYLD overlay 结构版本: %w", err)
	}
	return version, nil
}

func hasAICYLDOverlaySchemaLedger(db *gorm.DB) bool {
	var count int
	if err := db.Raw("SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name = ?", "table", "aicyld_schema_migrations").Scan(&count).Error; err != nil {
		return false
	}
	return count > 0
}

func listAICYLDOverlayMigrations(db *gorm.DB) ([]aicyldOverlayMigration, error) {
	if !hasAICYLDOverlaySchemaLedger(db) {
		return nil, nil
	}
	var rows []aicyldOverlayMigration
	if err := db.Order("version").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("读取 AICYLD overlay 结构迁移记录: %w", err)
	}
	return rows, nil
}

func assertAICYLDOverlayLedgerImmutable(db *gorm.DB, frozen []aicyldOverlayMigration) error {
	for _, old := range frozen {
		var actual aicyldOverlayMigration
		if err := db.First(&actual, "version = ?", old.Version).Error; err != nil {
			return fmt.Errorf("AICYLD overlay 历史迁移身份丢失: v%d %s: %w", old.Version, old.Name, err)
		}
		if actual.Name != old.Name || !actual.AppliedAt.Equal(old.AppliedAt) {
			return fmt.Errorf("AICYLD overlay 历史迁移身份被改写: v%d", old.Version)
		}
	}
	return nil
}
