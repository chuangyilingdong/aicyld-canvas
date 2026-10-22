package database

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestV23AddsUserSkillStateEnabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "v23.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM local_schema_migrations WHERE version >= 23").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_user_skill_states_enabled").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("ALTER TABLE user_skill_states DROP COLUMN enabled").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := RequireLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	var defaultValue string
	if err := db.Raw("SELECT dflt_value FROM pragma_table_info('user_skill_states') WHERE name = 'enabled'").Scan(&defaultValue).Error; err != nil {
		t.Fatal(err)
	}
	if defaultValue != "1" {
		t.Fatalf("enabled default = %q", defaultValue)
	}
}
