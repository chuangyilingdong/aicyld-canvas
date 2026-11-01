package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"infinite-canvas/backend/internal/database"
)

// schema-migrate applies only database migrations. It deliberately does not
// construct the app service, start HTTP, or launch task workers, so a migration
// rehearsal can never submit or recover a paid generation task.
func main() {
	dataDir := flag.String("data-dir", env("CANVAS_BACKEND_DATA_DIR", "data"), "Canvas data directory")
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "optional database DSN")
	flag.Parse()

	db, err := database.Open(database.Config{Driver: "sqlite", DSN: *databaseURL, DataDir: *dataDir})
	if err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	if err := database.MigrateLocalSchema(db); err != nil {
		log.Fatal(err)
	}
	if err := database.MigrateAICYLDOverlaySchema(db); err != nil {
		log.Fatal(err)
	}
	if err := database.RequireLocalSchema(db); err != nil {
		log.Fatal(err)
	}
	if err := database.RequireAICYLDOverlaySchema(db); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("schema migration complete: local=%d aicyld=%d\n", database.CurrentSchemaVersion, database.CurrentAICYLDOverlaySchemaVersion)
}

func env(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
