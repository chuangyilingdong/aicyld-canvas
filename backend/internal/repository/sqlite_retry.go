package repository

import (
	"errors"
	"time"

	"github.com/mattn/go-sqlite3"
)

func retrySQLiteBusy(operation func() error) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = operation()
		var sqliteErr sqlite3.Error
		if !errors.As(err, &sqliteErr) || (sqliteErr.Code != sqlite3.ErrBusy && sqliteErr.Code != sqlite3.ErrLocked) {
			return err
		}
		time.Sleep(time.Duration(20*(attempt+1)) * time.Millisecond)
	}
	return err
}
