package repository

import (
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openSSOWorkspaceTestRepository(t *testing.T) *Repository {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "sso.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = raw.Close() })
	if err := db.AutoMigrate(&model.Workspace{}); err != nil {
		t.Fatal(err)
	}
	return New(db)
}

func TestSSOWorkspaceIDIsStableAndBounded(t *testing.T) {
	first := SSOWorkspaceID("main-user-123")
	if first != SSOWorkspaceID("main-user-123") {
		t.Fatal("workspace ID is not stable")
	}
	if !strings.HasPrefix(first, SSOWorkspacePrefix) || len(first) > 36 {
		t.Fatalf("invalid workspace ID: %q", first)
	}
	long := SSOWorkspaceID(strings.Repeat("x", 128))
	if !strings.HasPrefix(long, SSOWorkspacePrefix) || len(long) > 36 {
		t.Fatalf("invalid long workspace ID: %q", long)
	}
	if long == SSOWorkspaceID(strings.Repeat("y", 128)) {
		t.Fatal("different main-site users collided")
	}
}

func TestEnsureWorkspaceIsIdempotent(t *testing.T) {
	repo := openSSOWorkspaceTestRepository(t)
	first, err := repo.EnsureWorkspace("main-user-123", "Alice")
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.EnsureWorkspace("main-user-123", "Ignored Rename")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.Name != "Alice" || second.Name != "Alice" {
		t.Fatalf("workspace changed: first=%+v second=%+v", first, second)
	}
	if first.ID != SSOWorkspaceID("main-user-123") {
		t.Fatalf("unexpected workspace ID: %s", first.ID)
	}
}
