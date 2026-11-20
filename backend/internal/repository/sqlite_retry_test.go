package repository

import (
	"testing"

	"github.com/mattn/go-sqlite3"
)

func TestRetrySQLiteBusyRetriesLockErrors(t *testing.T) {
	attempts := 0
	err := retrySQLiteBusy(func() error {
		attempts++
		if attempts < 3 {
			return sqlite3.Error{Code: sqlite3.ErrBusy}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("retry returned %v", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}

func TestRetrySQLiteBusyDoesNotHideConstraintErrors(t *testing.T) {
	attempts := 0
	constraint := sqlite3.Error{Code: sqlite3.ErrConstraint, ExtendedCode: sqlite3.ErrConstraintUnique}
	err := retrySQLiteBusy(func() error {
		attempts++
		return constraint
	})
	if err != constraint {
		t.Fatalf("err = %v, want %v", err, constraint)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}
