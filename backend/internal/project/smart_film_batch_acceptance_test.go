package project

import (
	"errors"
	"strconv"
	"testing"
	"time"

	"infinite-canvas/backend/internal/billing"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	localtask "infinite-canvas/backend/internal/task"
)

func TestSmartFilmPaidArchivePreservesPaginatedBillingAndRejectsAdmission(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "搜索用水杯", SourceText: "想法", BudgetPoints: 100})
	if err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "archive-project", UserID: "user-1", Name: "已付费项目", BatchID: created.ID, Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	tasks := []model.Task{
		{ID: "receipt-a", UserID: "user-1", ProjectID: project.ID, Status: model.TaskStatusSucceeded, Type: "canvas_image", InputJSON: `{}`, CreatedAt: now},
		{ID: "receipt-b", UserID: "user-1", Status: model.TaskStatusRunning, Type: "canvas_video", InputJSON: `{"metadata":{"domainProjectId":"archive-project","source":"smart-film-whole-video"}}`, CreatedAt: now},
		{ID: "foreign-receipt", UserID: "other", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"batchId":"` + created.ID + `"}}`, CreatedAt: now},
	}
	for _, task := range tasks {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Table("tasks").Where("id = ?", "receipt-a").Updates(map[string]any{"billing_hold_id": "hold-a", "billing_status": "settled", "billing_points": 7, "billing_reserved_points": 10, "billing_settled_points": 7, "billing_refunded_points": 3}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Table("tasks").Where("id = ?", "receipt-b").Updates(map[string]any{"billing_hold_id": "hold-b", "billing_status": "reserved", "billing_points": 2, "billing_reserved_points": 2}).Error; err != nil {
		t.Fatal(err)
	}
	page, err := svc.SmartFilmBatchBilling("user-1", created.ID, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(page.Tasks) != 1 || !page.HasMore || page.SettledPoints != 7 || page.RefundedPoints != 3 || page.ReservedPoints != 2 || page.ActiveTasks != 1 {
		t.Fatalf("page/totals = %+v", page)
	}
	second, err := svc.SmartFilmBatchBilling("user-1", created.ID, 2, 1)
	if err != nil || second.HasMore || len(second.Tasks) != 1 || second.Tasks[0].TaskID == page.Tasks[0].TaskID || second.SettledPoints != page.SettledPoints {
		t.Fatalf("second = %+v, %v", second, err)
	}
	if err := svc.repo.DeleteSmartFilmBatch("user-1", created.ID); !errors.Is(err, repository.ErrSmartFilmBatchActiveTasks) {
		t.Fatalf("active delete = %v", err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "receipt-b").Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.DeleteSmartFilmBatch("user-1", created.ID); err != nil {
		t.Fatal(err)
	}
	archived, err := svc.SmartFilmBatch("user-1", created.ID)
	if err != nil || archived.Status != "archived" {
		t.Fatalf("archive = %+v %v", archived, err)
	}
	if _, err := svc.repo.ProjectForUser("user-1", project.ID); err != nil {
		t.Fatal(err)
	}
	page, err = svc.SmartFilmBatchBilling("user-1", created.ID, 1, 100)
	if err != nil || page.Total != 2 || page.RefundedPoints != 3 {
		t.Fatalf("archived billing = %+v %v", page, err)
	}
	next := model.Task{ID: "blocked-free-task", UserID: "user-1", Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: `{"metadata":{"batchId":"` + created.ID + `"}}`}
	if err := svc.repo.CreateTaskWithActiveLimit(&next, 0); !errors.Is(err, repository.ErrSmartFilmBatchArchived) {
		t.Fatalf("archive admission = %v", err)
	}
	if _, err := svc.repo.SetSmartFilmBatchBudget("user-1", created.ID, 200); !errors.Is(err, repository.ErrSmartFilmBatchArchived) {
		t.Fatalf("archive budget = %v", err)
	}
	rows, total, err := svc.repo.SmartFilmBatchesForUser("user-1", "archived", "水杯", 1, 10)
	if err != nil || total != 1 || len(rows) != 1 {
		t.Fatalf("archive search=%+v total=%d err=%v", rows, total, err)
	}
	_, total, err = svc.repo.SmartFilmBatchesForUser("user-1", "", "水杯", 1, 10)
	if err != nil || total != 0 {
		t.Fatalf("default search total=%d err=%v", total, err)
	}
}

func TestSmartFilmVideoBudgetUsesEachDurationAndExcludesWholeFilm(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	svc.quoteTask = func(_ string, req localtask.CreateRequest) (*billing.BillingQuote, error) {
		points := 1
		if req.Type == "canvas_video" {
			cfg := req.Input["config"].(map[string]any)
			points, _ = strconv.Atoi(stringValue(cfg["videoSeconds"]))
		}
		return &billing.BillingQuote{Enabled: true, Points: points, Balance: 100}, nil
	}
	config := SmartFilmBatchConfig{ScriptCount: 1, ShotCount: 2, ShotDurationsSeconds: []float64{5, 10}, AudioMode: SmartFilmAudioModeNone, DefaultTextModel: "text", DefaultImageModel: "image", DefaultVideoModel: "video"}
	cost, err := svc.PreviewSmartFilmBatchCost("user-1", CreateSmartFilmBatchRequest{Title: "时长预算", SourceText: "想法", Config: config})
	if err != nil {
		t.Fatal(err)
	}
	videoPoints := 0
	for _, item := range cost.Items {
		if item.Stage == "video" {
			videoPoints += item.Points
		}
	}
	if videoPoints != 15 {
		t.Fatalf("video points=%d want15", videoPoints)
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "整片预算", SourceText: "想法", Config: config, BudgetPoints: 100})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{ExpectedRevision: created.Revision, Scripts: []SmartFilmScriptInput{{Title: "剧本", Content: "内容"}}})
	if err != nil {
		t.Fatal(err)
	}
	confirmed, err := svc.ConfirmSmartFilmBatchScripts("user-1", saved.ID, ConfirmSmartFilmBatchScriptsRequest{ExpectedRevision: saved.Revision, ScriptIDs: []string{saved.Scripts[0].ID}})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.SmartFilmBatchForUser("user-1", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	config.ProductionMode = SmartFilmProductionModeSmart
	config.TargetDurationSeconds = 15
	stored.ConfigJSON = mustJSON(config)
	if err := db.Model(stored).Update("config_json", stored.ConfigJSON).Error; err != nil {
		t.Fatal(err)
	}
	before, err := svc.SmartFilmBatchCost("user-1", created.ID)
	if err != nil {
		t.Fatal(err)
	}
	whole := model.Task{ID: "whole-running", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"source":"smart-film-whole-video","domainProjectId":"` + confirmed.Scripts[0].ProjectID + `"}}`}
	if err := db.Create(&whole).Error; err != nil {
		t.Fatal(err)
	}
	after, err := svc.SmartFilmBatchCost("user-1", created.ID)
	if err != nil || before.EstimatedPoints-after.EstimatedPoints != 15 {
		t.Fatalf("whole estimate before=%+v after=%+v err=%v", before, after, err)
	}
}

func TestSmartFilmBudgetCASDistinguishesStaleRevision(t *testing.T) {
	svc, db := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "预算并发", SourceText: "想法", BudgetPoints: 20})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SmartFilmBatch{}).Where("id = ?", created.ID).Update("budget_used_points", 10).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.repo.UpdateSmartFilmBatch("user-1", created.ID, created.Revision, map[string]any{"budget_points": 5}); !errors.Is(err, repository.ErrSmartFilmBudgetBelowUsed) {
		t.Fatalf("cap error=%v", err)
	}
	if _, err := svc.repo.UpdateSmartFilmBatch("user-1", created.ID, created.Revision+1, map[string]any{"budget_points": 15}); !errors.Is(err, repository.ErrProjectRevisionConflict) {
		t.Fatalf("revision error=%v", err)
	}
}

func TestSmartFilmCreateCanEstimateBeforeAllocatingBatchID(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	svc.encryptSecret = func(value string) (string, error) { return value, nil }
	svc.decryptSecret = func(value string) (string, error) { return value, nil }
	svc.quoteTask = func(string, localtask.CreateRequest) (*billing.BillingQuote, error) {
		return &billing.BillingQuote{Enabled: true, Points: 1, Balance: 100}, nil
	}
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "自动预算", SourceText: "想法", Config: SmartFilmBatchConfig{ScriptCount: 1, ShotCount: 1, AudioMode: SmartFilmAudioModeNone, DefaultTextModel: "text", DefaultImageModel: "image", DefaultVideoModel: "video"}, OrchestrationConfig: map[string]any{"text": map[string]any{"model": "text"}}})
	if err != nil || created.BudgetPoints <= 0 {
		t.Fatalf("initial estimate=%+v err=%v", created, err)
	}
}

func TestSmartFilmAudioPolicyChangesArePreviewedBeforeSaving(t *testing.T) {
	svc, _ := newTestService(t, &recordingWorkflows{})
	created, err := svc.CreateSmartFilmBatch("user-1", CreateSmartFilmBatchRequest{Title: "音频策略", SourceText: "想法", BudgetPoints: 100, Config: SmartFilmBatchConfig{ScriptCount: 1, ShotCount: 1, AudioMode: SmartFilmAudioModeNative, VideoNativeAudio: true, DefaultTextModel: "text", DefaultImageModel: "image", DefaultVideoModel: "video"}})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := svc.SaveSmartFilmBatchScripts("user-1", created.ID, SaveSmartFilmBatchScriptsRequest{ExpectedRevision: created.Revision, Scripts: []SmartFilmScriptInput{{Title: "剧本", Content: "内容"}}})
	if err != nil {
		t.Fatal(err)
	}
	req := UpdateSmartFilmBatchProductionConfigRequest{ProductionMode: SmartFilmProductionModeFixed, ShotCount: 1, ShotDurationsSeconds: []float64{5}, AudioMode: SmartFilmAudioModeNone, ExpectedRevision: saved.Revision}
	if _, err := svc.PreviewSmartFilmBatchProductionConfig("user-1", created.ID, req); err != nil {
		t.Fatal(err)
	}
	before, err := svc.SmartFilmBatch("user-1", created.ID)
	if err != nil || before.Config.AudioMode != SmartFilmAudioModeNative {
		t.Fatalf("preview changed audio=%+v err=%v", before, err)
	}
	after, err := svc.UpdateSmartFilmBatchProductionConfig("user-1", created.ID, req)
	if err != nil || after.Config.AudioMode != SmartFilmAudioModeNone {
		t.Fatalf("audio update=%+v err=%v", after, err)
	}
}
