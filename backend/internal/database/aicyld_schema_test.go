package database

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type aicyldBillingTaskRow struct {
	ID            string `gorm:"primaryKey"`
	BillingHoldID string `gorm:"column:billing_hold_id"`
	BillingStatus string `gorm:"column:billing_status"`
	BillingPoints int    `gorm:"column:billing_points"`
}

func (aicyldBillingTaskRow) TableName() string { return "tasks" }

func openAICYLDOverlayTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "overlay.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := ConfigurePool(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func dropAICYLDHostedBillingTaskFields(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Exec("DROP INDEX IF EXISTS idx_tasks_billing_hold_id").Error; err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"billing_hold_id", "billing_status", "billing_points"} {
		has, err := sqliteHasColumn(db, "tasks", column)
		if err != nil {
			t.Fatal(err)
		}
		if !has {
			continue
		}
		if err := db.Exec("ALTER TABLE tasks DROP COLUMN " + column).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestMigrateAICYLDOverlaySchemaAddsBillingFieldsAndKeepsOfficialLedger(t *testing.T) {
	db := openAICYLDOverlayTestDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	var officialBefore []localSchemaMigration
	if err := db.Order("version").Find(&officialBefore).Error; err != nil {
		t.Fatal(err)
	}
	dropAICYLDHostedBillingTaskFields(t, db)

	for i := 0; i < 2; i++ {
		if err := MigrateAICYLDOverlaySchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := RequireAICYLDOverlaySchema(db); err != nil {
		t.Fatal(err)
	}
	status, err := ReadAICYLDOverlaySchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != 2 || status.Expected != 2 {
		t.Fatalf("unexpected overlay status: %+v", status)
	}
	var rows []aicyldOverlayMigration
	if err := db.Order("version").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].Version != 1 || rows[0].Name != "hosted-billing-task-fields" || rows[1].Version != 2 || rows[1].Name != "plugin-publication-releases" {
		t.Fatalf("unexpected overlay ledger: %+v", rows)
	}
	if !db.Migrator().HasTable("plugin_publications") || !db.Migrator().HasTable("plugin_releases") {
		t.Fatal("plugin publication tables missing after overlay migration")
	}
	var officialAfter []localSchemaMigration
	if err := db.Order("version").Find(&officialAfter).Error; err != nil {
		t.Fatal(err)
	}
	if len(officialAfter) != len(officialBefore) {
		t.Fatalf("official ledger changed: before=%d after=%d", len(officialBefore), len(officialAfter))
	}
	for i := range officialBefore {
		if officialBefore[i] != officialAfter[i] {
			t.Fatalf("official migration changed at %d: %+v != %+v", i, officialBefore[i], officialAfter[i])
		}
	}

	task := aicyldBillingTaskRow{
		ID:            "task-overlay",
		BillingHoldID: "hold-1",
		BillingStatus: "reserved",
		BillingPoints: 17,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateAICYLDOverlaySchema(db); err != nil {
		t.Fatal(err)
	}
	var got aicyldBillingTaskRow
	if err := db.First(&got, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if got.BillingHoldID != "hold-1" || got.BillingStatus != "reserved" || got.BillingPoints != 17 {
		t.Fatalf("billing fields changed: %+v", got)
	}
}

func TestMigrateAICYLDOverlaySchemaRollsBackFailedMigration(t *testing.T) {
	db := openAICYLDOverlayTestDB(t)
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	dropAICYLDHostedBillingTaskFields(t, db)
	if hasAICYLDOverlaySchemaLedger(db) {
		if err := db.Exec("DELETE FROM aicyld_schema_migrations").Error; err != nil {
			t.Fatal(err)
		}
	} else if err := db.AutoMigrate(&aicyldOverlayMigration{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER fail_aicyld_v1 BEFORE INSERT ON aicyld_schema_migrations WHEN NEW.version = 1 BEGIN SELECT RAISE(ABORT, 'injected'); END").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateAICYLDOverlaySchema(db); err == nil {
		t.Fatal("migration succeeded despite injected ledger failure")
	}
	for _, column := range []string{"billing_hold_id", "billing_status", "billing_points"} {
		has, err := sqliteHasColumn(db, "tasks", column)
		if err != nil {
			t.Fatal(err)
		}
		if has {
			t.Fatalf("column %s survived rolled-back migration", column)
		}
	}
}
