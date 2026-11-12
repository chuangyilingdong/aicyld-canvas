package model

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"time"

	"gorm.io/gorm"
)

const (
	AgentOpResultEncodingGzipBase64 = "gzip+base64"
	agentOpResultCompressedPrefix   = "gzip+b64:"
	agentOpResultCompressThreshold  = 32 * 1024
)

// AgentOpRecord 持久化已执行的操作，用于操作 ID 去重：
// 同一 opId 且同一 payload 回读原结果；同一 opId 不同 payload 视为冲突。
//
// TurnID 是写入发生时所属的助手回合。它和业务写入在同一个事务里提交，
// 因此回合的「已落地改动」可以不依赖浏览器流，从回执重建。
type AgentOpRecord struct {
	UserID         string    `json:"userId" gorm:"primaryKey;size:36;index:idx_agent_op_records_user_op_status,priority:1"`
	OpID           string    `json:"opId" gorm:"primaryKey;size:80"`
	Op             string    `json:"op" gorm:"size:80;index:idx_agent_op_records_user_op_status,priority:2"`
	PayloadHash    string    `json:"payloadHash" gorm:"size:64"`
	Status         string    `json:"status" gorm:"size:24;index:idx_agent_op_records_user_op_status,priority:3"`
	ResultJSON     string    `json:"resultJson" gorm:"type:text"`
	ResultEncoding string    `json:"resultEncoding,omitempty" gorm:"size:32"`
	TurnID         string    `json:"turnId,omitempty" gorm:"size:64;index"`
	CallerKind     string    `json:"callerKind,omitempty" gorm:"size:24"`
	ClientID       string    `json:"clientId,omitempty" gorm:"size:80"`
	ClientLabel    string    `json:"clientLabel,omitempty" gorm:"size:120"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// EncodeAgentOpResult compresses only large receipts that benefit materially.
// The prefix keeps older partial selects decodable even if result_encoding was
// not selected by the caller.
func EncodeAgentOpResult(raw []byte) (string, string, error) {
	if len(raw) < agentOpResultCompressThreshold {
		return string(raw), "", nil
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(raw); err != nil {
		return "", "", err
	}
	if err := writer.Close(); err != nil {
		return "", "", err
	}
	encoded := agentOpResultCompressedPrefix + base64.StdEncoding.EncodeToString(compressed.Bytes())
	if len(encoded) >= len(raw)*3/4 {
		return string(raw), "", nil
	}
	return encoded, AgentOpResultEncodingGzipBase64, nil
}

func DecodeAgentOpResult(value, encoding string) ([]byte, error) {
	compressed := strings.HasPrefix(value, agentOpResultCompressedPrefix)
	if encoding == "" && !compressed {
		return []byte(value), nil
	}
	if encoding != "" && encoding != AgentOpResultEncodingGzipBase64 {
		return nil, fmt.Errorf("unsupported agent operation result encoding %q", encoding)
	}
	if !compressed {
		return nil, fmt.Errorf("agent operation result is marked %q but has no compression prefix", encoding)
	}
	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, agentOpResultCompressedPrefix))
	if err != nil {
		return nil, fmt.Errorf("decode agent operation result: %w", err)
	}
	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("open agent operation result gzip: %w", err)
	}
	defer reader.Close()
	raw, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read agent operation result gzip: %w", err)
	}
	return raw, nil
}

func (r *AgentOpRecord) BeforeSave(*gorm.DB) error {
	if r.ResultEncoding != "" {
		return nil
	}
	value, encoding, err := EncodeAgentOpResult([]byte(r.ResultJSON))
	if err != nil {
		return err
	}
	r.ResultJSON = value
	r.ResultEncoding = encoding
	return nil
}

func (r *AgentOpRecord) AfterFind(*gorm.DB) error {
	raw, err := DecodeAgentOpResult(r.ResultJSON, r.ResultEncoding)
	if err != nil {
		return err
	}
	r.ResultJSON = string(raw)
	r.ResultEncoding = ""
	return nil
}
