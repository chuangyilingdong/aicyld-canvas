package project

import "time"

const (
	SmartFilmScriptStatusDraft           = "draft"
	SmartFilmScriptStatusProjectCreated  = "project_created"
	SmartFilmScriptStatusAssetsExtracted = "assets_extracted"
	SmartFilmScriptStatusStoryboardReady = "storyboard_ready"
	SmartFilmScriptStatusNeedsAttention  = "needs_attention"
	SmartFilmScriptStatusFailed          = "failed"

	SmartFilmProductionRunStatusPending        = "pending"
	SmartFilmProductionRunStatusReady          = "ready"
	SmartFilmProductionRunStatusNeedsAttention = "needs_attention"
	SmartFilmProductionRunStatusFailed         = "failed"
	SmartFilmProductionRunStatusSkipped        = "skipped"
	SmartFilmProductionStageStatusPending      = "pending"
	SmartFilmProductionStageStatusWaiting      = "waiting"
	SmartFilmProductionStageStatusQueued       = "queued"
	SmartFilmProductionStageStatusRunning      = "running"
	SmartFilmProductionStageStatusReady        = "ready"
	SmartFilmProductionStageStatusConfirmed    = "confirmed"
	SmartFilmProductionStageStatusAttention    = "needs_attention"
	SmartFilmProductionControlActive           = "active"
	SmartFilmProductionControlPaused           = "paused"
	SmartFilmProductionControlSkipped          = "skipped"

	SmartFilmProductionStepProject           = "project"
	SmartFilmProductionStepUnit              = "unit"
	SmartFilmProductionStepAssetLink         = "asset_link"
	SmartFilmProductionStepBatch             = "batch_update"
	SmartFilmProductionStepAssets            = "assets"
	SmartFilmProductionStepStoryboard        = "storyboard"
	SmartFilmProductionStepCompleted         = "completed"
	SmartFilmProductionActionRetry           = "retry_confirm"
	SmartFilmProductionActionRetryAssets     = "retry_assets"
	SmartFilmProductionActionRetryStoryboard = "retry_storyboard"
)

type SmartFilmBatchConfig struct {
	AspectRatio          string    `json:"aspectRatio"`
	StylePresetID        string    `json:"stylePresetId,omitempty"`
	StyleProfileJSON     string    `json:"styleProfileJson,omitempty"`
	DefaultTextModel     string    `json:"defaultTextModel,omitempty"`
	DefaultImageModel    string    `json:"defaultImageModel,omitempty"`
	DefaultVideoModel    string    `json:"defaultVideoModel,omitempty"`
	ScriptCount          int       `json:"scriptCount"`
	ShotCount            int       `json:"shotCount"`
	ShotDurationSeconds  float64   `json:"shotDurationSeconds"`
	ShotDurationsSeconds []float64 `json:"shotDurationsSeconds,omitempty"`
}

type SmartFilmOrchestrationConfig struct {
	Text  map[string]any `json:"text,omitempty"`
	Image map[string]any `json:"image,omitempty"`
	Video map[string]any `json:"video,omitempty"`
}

type SmartFilmScript struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	ProjectID string    `json:"projectId,omitempty"`
	UnitID    string    `json:"unitId,omitempty"`
	TaskID    string    `json:"taskId,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type SmartFilmProductionResources struct {
	ProjectID      string   `json:"projectId,omitempty"`
	UnitID         string   `json:"unitId,omitempty"`
	LinkedAssetIDs []string `json:"linkedAssetIds"`
}

type SmartFilmProductionRunView struct {
	ID                  string                       `json:"id"`
	BatchID             string                       `json:"batchId"`
	ScriptID            string                       `json:"scriptId"`
	IdempotencyKey      string                       `json:"idempotencyKey"`
	Status              string                       `json:"status"`
	CurrentStep         string                       `json:"currentStep"`
	Resources           SmartFilmProductionResources `json:"resources"`
	FailedStep          string                       `json:"failedStep,omitempty"`
	Error               string                       `json:"error,omitempty"`
	RecoverableAction   string                       `json:"recoverableAction,omitempty"`
	AssetStatus         string                       `json:"assetStatus"`
	AssetTaskID         string                       `json:"assetTaskId,omitempty"`
	AssetCount          int                          `json:"assetCount"`
	StoryboardStatus    string                       `json:"storyboardStatus"`
	StoryboardTaskID    string                       `json:"storyboardTaskId,omitempty"`
	StoryboardShotCount int                          `json:"storyboardShotCount"`
	ControlStatus       string                       `json:"controlStatus"`
	Attempts            int                          `json:"attempts"`
	Revision            int64                        `json:"revision"`
	CreatedAt           time.Time                    `json:"createdAt"`
	UpdatedAt           time.Time                    `json:"updatedAt"`
}

type SmartFilmBatchView struct {
	ID             string                       `json:"id"`
	Title          string                       `json:"title"`
	SourceText     string                       `json:"sourceText"`
	InputAssetIDs  []string                     `json:"inputAssetIds"`
	Config         SmartFilmBatchConfig         `json:"config"`
	Scripts        []SmartFilmScript            `json:"scripts"`
	ProductionRuns []SmartFilmProductionRunView `json:"productionRuns"`
	Status         string                       `json:"status"`
	Paused         bool                         `json:"paused"`
	BudgetPoints   int                          `json:"budgetPoints"`
	Control        SmartFilmBatchControlView    `json:"control"`
	Revision       int64                        `json:"revision"`
	CreatedAt      time.Time                    `json:"createdAt"`
	UpdatedAt      time.Time                    `json:"updatedAt"`
}

type SmartFilmBatchListPage struct {
	Batches  []SmartFilmBatchView `json:"batches"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
	Total    int64                `json:"total"`
	HasMore  bool                 `json:"hasMore"`
}

type SmartFilmBatchControlView struct {
	CurrentRunID     string   `json:"currentRunId,omitempty"`
	CurrentProjectID string   `json:"currentProjectId,omitempty"`
	WaitingRunIDs    []string `json:"waitingRunIds"`
	QueuedCount      int      `json:"queuedCount"`
	RunningCount     int      `json:"runningCount"`
}

type CreateSmartFilmBatchRequest struct {
	Title               string               `json:"title"`
	SourceText          string               `json:"sourceText"`
	InputAssetIDs       []string             `json:"inputAssetIds"`
	Config              SmartFilmBatchConfig `json:"config"`
	OrchestrationConfig map[string]any       `json:"orchestrationConfig,omitempty"`
	BudgetPoints        int                  `json:"budgetPoints,omitempty"`
}

type UpdateSmartFilmBatchBudgetRequest struct {
	BudgetPoints int `json:"budgetPoints"`
}

type SmartFilmBatchCostItem struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Stage   string `json:"stage"`
	Count   int    `json:"count"`
	Points  int    `json:"points"`
	Enabled bool   `json:"enabled"`
}

type SmartFilmBatchCostView struct {
	Enabled         bool                     `json:"enabled"`
	BudgetPoints    int                      `json:"budgetPoints"`
	CommittedPoints int                      `json:"committedPoints"`
	EstimatedPoints int                      `json:"estimatedPoints"`
	TotalPoints     int                      `json:"totalPoints"`
	OverBudget      bool                     `json:"overBudget"`
	Balance         int                      `json:"balance"`
	Items           []SmartFilmBatchCostItem `json:"items"`
}

type SmartFilmScriptInput struct {
	ID      string `json:"id,omitempty"`
	Title   string `json:"title"`
	Content string `json:"content"`
	TaskID  string `json:"taskId,omitempty"`
}

type SaveSmartFilmBatchScriptsRequest struct {
	Scripts          []SmartFilmScriptInput `json:"scripts"`
	ExpectedRevision int64                  `json:"expectedRevision"`
}

type UpdateSmartFilmBatchScriptRequest struct {
	Title            string `json:"title"`
	Content          string `json:"content"`
	Status           string `json:"status,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	ExpectedRevision int64  `json:"expectedRevision"`
}

type DeleteSmartFilmBatchScriptRequest struct {
	ExpectedRevision int64 `json:"expectedRevision"`
}

type ConfirmSmartFilmBatchScriptsRequest struct {
	ScriptIDs        []string `json:"scriptIds"`
	ExpectedRevision int64    `json:"expectedRevision"`
}

type SmartFilmProductionStageCheckpointRequest struct {
	Stage         string `json:"stage"`
	Status        string `json:"status"`
	TaskID        string `json:"taskId,omitempty"`
	Error         string `json:"error,omitempty"`
	ResourceCount int    `json:"resourceCount,omitempty"`
}

type StartSmartFilmProductionStageRequest struct {
	Stage string `json:"stage"`
}

type SmartFilmBatchControlRequest struct {
	Action string `json:"action"`
}

type SmartFilmProductionRunControlRequest struct {
	Action string `json:"action"`
	Stage  string `json:"stage,omitempty"`
}

type SmartFilmAssetExtractionWorkItem struct {
	RunID              string
	UserID             string
	BatchID            string
	ScriptID           string
	ProjectID          string
	UnitID             string
	ProjectName        string
	ProjectStyle       string
	ScriptTitle        string
	ScriptContent      string
	TextModel          string
	TextConfig         map[string]any
	LogicalModelID     string
	ConfigurationError string
	AssetTaskID        string
	AssetStatus        string
}

type SmartFilmStoryboardAsset struct {
	ID               string         `json:"id"`
	Title            string         `json:"title"`
	Category         string         `json:"category"`
	MediaType        string         `json:"mediaType"`
	PrimaryVersionID string         `json:"primaryVersionId,omitempty"`
	Prompt           string         `json:"prompt"`
	Definition       map[string]any `json:"definition,omitempty"`
}

type SmartFilmStoryboardWorkItem struct {
	RunID                string
	UserID               string
	BatchID              string
	ScriptID             string
	ProjectID            string
	UnitID               string
	ProjectName          string
	ProjectStyle         string
	ProjectRevision      int64
	ScriptTitle          string
	ScriptContent        string
	TextModel            string
	TextConfig           map[string]any
	LogicalModelID       string
	ConfigurationError   string
	ShotCount            int
	ShotDurationSeconds  float64
	ShotDurationsSeconds []float64
	Assets               []SmartFilmStoryboardAsset
	ExistingShotIDs      []string
	StoryboardTaskID     string
	StoryboardStatus     string
}
