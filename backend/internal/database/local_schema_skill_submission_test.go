package database

import (
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestSkillSubmissionMigrationGrandfathersExistingPublicSkills(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skill-submissions.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	defer sql.Close()
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.SkillSubmission{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM local_schema_migrations WHERE version >= ?", 29).Error; err != nil {
		t.Fatal(err)
	}
	publicSkill := model.Skill{ID: "public-skill", OwnerID: "owner", Name: "Public", Status: 1}
	privateSkill := model.Skill{ID: "private-skill", OwnerID: "owner", Name: "Private", Status: 1, IsPrivate: true}
	if err := db.Create(&publicSkill).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&privateSkill).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id IN ?", []string{publicSkill.ID, privateSkill.ID}).Update("review_status", "").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.SkillSubmission{}) {
		t.Fatal("skill_submissions table was not created")
	}
	var public, private model.Skill
	if err := db.First(&public, "id = ?", publicSkill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&private, "id = ?", privateSkill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if public.ReviewStatus != "published" || private.ReviewStatus != "draft" {
		t.Fatalf("grandfathered statuses = public:%q private:%q", public.ReviewStatus, private.ReviewStatus)
	}
}
