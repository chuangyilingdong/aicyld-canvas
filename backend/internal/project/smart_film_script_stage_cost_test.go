package project

import (
	"testing"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

func TestSmartFilmScriptStageDefersProductionSpecAndBudget(t *testing.T) {
	for _, mode := range []string{SmartFilmProductionModeFixed, SmartFilmProductionModeSmart} {
		t.Run(mode, func(t *testing.T) {
			svc, db := newTestService(t, &recordingWorkflows{})
			svc.encryptSecret = func(value string) (string, error) { return value, nil }
			svc.decryptSecret = func(value string) (string, error) { return value, nil }
			var quoted []localtask.CreateRequest
			svc.quoteTask = func(_ string, req localtask.CreateRequest) (*billing.BillingQuote, error) {
				quoted = append(quoted, req)
				return &billing.BillingQuote{Enabled: true, Points: 2, Balance: 100}, nil
			}
			req := CreateSmartFilmBatchRequest{
				Title: "Script first", SourceText: "Independent stories", ScriptPrompt: "Generate two independent scripts without shot constraints",
				Config:              SmartFilmBatchConfig{ScriptCount: 2, AudioMode: SmartFilmAudioModeNone, DefaultTextModel: "text", DefaultImageModel: "image", DefaultVideoModel: "video"},
				OrchestrationConfig: map[string]any{"text": map[string]any{"model": "text"}},
			}
			preview, err := svc.PreviewSmartFilmBatchCost("user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			if len(quoted) != 1 || quoted[0].Type != "canvas_text" || quoted[0].Operation != "text" || quoted[0].Prompt != req.ScriptPrompt {
				t.Fatalf("initial quotes = %+v", quoted)
			}
			if len(preview.Items) != 1 || preview.Items[0].Stage != "script" || preview.TotalPoints != 2 {
				t.Fatalf("initial cost = %+v", preview)
			}
			var batchCount int64
			if err := db.Model(&model.SmartFilmBatch{}).Count(&batchCount).Error; err != nil || batchCount != 0 {
				t.Fatalf("preview wrote batches: count=%d err=%v", batchCount, err)
			}
			created, err := svc.CreateSmartFilmBatch("user-1", req)
			if err != nil {
				t.Fatal(err)
			}
			if created.Config.ProductionMode != "" || created.Config.ShotCount != 0 || len(created.Config.ShotDurationsSeconds) != 0 || created.Config.TargetDurationSeconds != 0 || created.BudgetPoints != 2 {
				t.Fatalf("creation imposed production settings: %+v", created)
			}
			saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{
				ExpectedRevision: created.Revision,
				Scripts:          []SmartFilmScriptInput{{Title: "First", Content: "First story"}, {Title: "Second", Content: "Second story"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			quoted = nil
			waiting, err := svc.SmartFilmBatchCost("user-1", created.ID)
			if err != nil || len(quoted) != 0 || waiting.EstimatedPoints != 0 || len(waiting.Items) != 0 {
				t.Fatalf("unconfigured production was quoted: cost=%+v requests=%+v err=%v", waiting, quoted, err)
			}
			if _, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID}}); err == nil {
				t.Fatal("production started before selecting a strategy")
			}
			production := UpdateSmartFilmBatchProductionConfigRequest{ProductionMode: mode, AudioMode: SmartFilmAudioModeNone, ExpectedRevision: saved.Revision}
			if mode == SmartFilmProductionModeFixed {
				production.ShotCount = 2
				production.ShotDurationsSeconds = []float64{5, 10}
			} else {
				production.TargetDurationSeconds = 15
			}
			productionPreview, err := svc.PreviewSmartFilmBatchProductionConfig("user-1", saved.ID, production)
			if err != nil || productionPreview.EstimatedPoints <= created.BudgetPoints {
				t.Fatalf("production preview = %+v err=%v", productionPreview, err)
			}
			before, err := svc.SmartFilmBatch("user-1", saved.ID)
			if err != nil || before.Config.ProductionMode != "" || before.BudgetPoints != 2 || before.Revision != saved.Revision {
				t.Fatalf("preview changed saved settings: %+v err=%v", before, err)
			}
			production.BudgetPoints = &productionPreview.TotalPoints
			updated, err := svc.UpdateSmartFilmBatchProductionConfig("user-1", saved.ID, production)
			if err != nil || updated.Config.ProductionMode != mode || updated.BudgetPoints != productionPreview.TotalPoints {
				t.Fatalf("confirmed production = %+v err=%v", updated, err)
			}
			confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", updated.ID, ConfirmSmartFilmBatchScriptsRequest{ExpectedRevision: updated.Revision, ScriptIDs: []string{saved.Scripts[0].ID}})
			if err != nil || confirmed.Scripts[0].ProjectID == "" {
				t.Fatalf("production after confirmation = %+v err=%v", confirmed, err)
			}
		})
	}
}
