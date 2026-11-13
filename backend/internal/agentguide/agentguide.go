package agentguide

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"strings"
)

//go:embed skilldata/SKILL.md
var skillFiles embed.FS

const (
	Name    = "aicyld-canvas-agent"
	Version = "1"
)

type Document struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	ContentHash string `json:"contentHash"`
	Text        string `json:"text"`
}

func Load() Document {
	text := strings.TrimSpace(mustRead("skilldata/SKILL.md")) + "\n"
	sum := sha256.Sum256([]byte(text))
	return Document{Name: Name, Version: Version, ContentHash: hex.EncodeToString(sum[:]), Text: text}
}

func mustRead(name string) string {
	raw, err := skillFiles.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return string(raw)
}
