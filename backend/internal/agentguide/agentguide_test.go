package agentguide

import (
	"os"
	"strings"
	"testing"
)

func TestGuideMatchesExternalCanvasSkill(t *testing.T) {
	raw, err := os.ReadFile("../../../plugins/beeftv-skills/skills/beeftv-canvas/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	doc := Load()
	if strings.TrimSpace(string(raw))+"\n" != doc.Text {
		t.Fatal("agent.guide content drifted from the external canvas skill")
	}
	if len(doc.ContentHash) != 64 || doc.Name == "" || doc.Version == "" {
		t.Fatalf("invalid guide document: %#v", doc)
	}
}
