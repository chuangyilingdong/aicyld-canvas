package database

import (
	"encoding/json"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRepairGPTImage26ReferenceCapability(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:gpt-image-26-capability?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	config := map[string]any{
		"version": 1,
		"image": map[string]any{
			"references": map[string]any{
				"promptMaxChars": 5000,
				"maxImages":      2,
			},
		},
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	row := model.ChannelModel{
		ID:                   "MODEL_000030",
		ChannelID:            "aicyld-seedance",
		ModelKey:             "zhenzhen-image-g-v2.6-lowprice",
		Capability:           "image",
		Enabled:              true,
		CapabilityConfigJSON: string(encoded),
		CapabilityVersion:    1,
		CreatedAt:            time.Now(),
		UpdatedAt:            time.Now(),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateRepairGPTImage26ReferenceCapability(db); err != nil {
		t.Fatal(err)
	}
	var stored model.ChannelModel
	if err := db.First(&stored, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	var repaired map[string]any
	if err := json.Unmarshal([]byte(stored.CapabilityConfigJSON), &repaired); err != nil {
		t.Fatal(err)
	}
	references := repaired["image"].(map[string]any)["references"].(map[string]any)
	if references["maxImages"] != float64(16) || references["promptMaxChars"] != float64(32000) || stored.CapabilityVersion != 2 {
		t.Fatalf("repaired capability = %#v version=%d", references, stored.CapabilityVersion)
	}
}
