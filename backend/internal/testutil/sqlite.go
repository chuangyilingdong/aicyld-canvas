package testutil

import (
	"testing"

	"gorm.io/gorm"
)

// CloseDBOnCleanup closes a test-owned database before t.TempDir cleanup runs.
// It is safe to call before checking the gorm.Open error because nil is ignored.
func CloseDBOnCleanup(t testing.TB, db *gorm.DB) {
	t.Helper()
	if db == nil {
		return
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Errorf("get test database handle: %v", err)
		return
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close test database: %v", err)
		}
	})
}
