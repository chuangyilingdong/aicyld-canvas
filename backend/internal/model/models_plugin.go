package model

import "time"

const (
	PluginPublicationStatusDraft     = "draft"
	PluginPublicationStatusReview    = "review"
	PluginPublicationStatusPublished = "published"
	PluginPublicationStatusDisabled  = "disabled"
	PluginPublicationStatusRevoked   = "revoked"

	PluginReleaseReviewDraft    = "draft"
	PluginReleaseReviewReview   = "review"
	PluginReleaseReviewApproved = "approved"
	PluginReleaseReviewRejected = "rejected"
	PluginReleaseReviewRevoked  = "revoked"
)

// PluginPlatformState stores the administrator-controlled availability of a
// plugin. User activation can never make an unavailable plugin effective.
type PluginPlatformState struct {
	PluginID  string    `json:"pluginId" gorm:"primaryKey;size:120"`
	Available bool      `json:"available" gorm:"index"`
	UpdatedBy string    `json:"updatedBy" gorm:"index;size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UserPluginState stores one user's activation choice for an application
// plugin. System-scoped protocol and uploaded plugins do not use this table.
type UserPluginState struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_plugin_state_user_plugin,priority:1"`
	PluginID  string    `json:"pluginId" gorm:"size:120;index;uniqueIndex:idx_user_plugin_state_user_plugin,priority:2"`
	Enabled   bool      `json:"enabled" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// PluginPublication is the administrator-controlled release state for one
// plugin ID. The current release pointer changes only through an audited
// publication transition; package identity itself lives in PluginRelease.
type PluginPublication struct {
	PluginID           string     `json:"pluginId" gorm:"primaryKey;size:120"`
	Status             string     `json:"status" gorm:"size:24;index;not null"`
	CurrentReleaseID   string     `json:"currentReleaseId" gorm:"size:36;index"`
	CandidateReleaseID string     `json:"candidateReleaseId,omitempty" gorm:"size:36;index"`
	CreatedBy          string     `json:"createdBy" gorm:"size:36"`
	UpdatedBy          string     `json:"updatedBy" gorm:"size:36"`
	SubmittedAt        *time.Time `json:"submittedAt,omitempty"`
	PublishedAt        *time.Time `json:"publishedAt,omitempty"`
	DisabledAt         *time.Time `json:"disabledAt,omitempty"`
	RevokedAt          *time.Time `json:"revokedAt,omitempty"`
	RevokeReason       string     `json:"revokeReason,omitempty" gorm:"size:1000"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

// PluginRelease stores the immutable package identity and the review/release
// evidence for one uploaded version. Version and package hash are unique so a
// later rollback cannot silently substitute different package bytes.
type PluginRelease struct {
	ID                string     `json:"id" gorm:"primaryKey;size:36"`
	PluginID          string     `json:"pluginId" gorm:"size:120;index;uniqueIndex:idx_plugin_release_version,priority:1"`
	Version           string     `json:"version" gorm:"size:64;uniqueIndex:idx_plugin_release_version,priority:2"`
	PackageSHA256     string     `json:"packageSha256" gorm:"size:64;uniqueIndex:idx_plugin_release_sha256"`
	ReviewStatus      string     `json:"reviewStatus" gorm:"size:24;index;not null"`
	ManifestJSON      string     `json:"manifestJson" gorm:"type:text;not null"`
	PermissionsJSON   string     `json:"permissionsJson" gorm:"type:text"`
	ContributionsJSON string     `json:"contributionsJson" gorm:"type:text"`
	HostAPIVersion    string     `json:"hostApiVersion" gorm:"size:40"`
	ReleaseNotes      string     `json:"releaseNotes" gorm:"type:text"`
	ReviewNotes       string     `json:"reviewNotes" gorm:"type:text"`
	RevokeReason      string     `json:"revokeReason,omitempty" gorm:"size:1000"`
	CreatedBy         string     `json:"createdBy" gorm:"size:36"`
	ReviewedBy        string     `json:"reviewedBy,omitempty" gorm:"size:36"`
	PublishedBy       string     `json:"publishedBy,omitempty" gorm:"size:36"`
	ReviewedAt        *time.Time `json:"reviewedAt,omitempty"`
	PublishedAt       *time.Time `json:"publishedAt,omitempty"`
	RevokedAt         *time.Time `json:"revokedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}
