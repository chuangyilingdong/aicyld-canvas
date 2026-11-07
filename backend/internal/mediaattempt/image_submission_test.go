package mediaattempt

import (
	"testing"

	"infinite-canvas/backend/internal/generation"
)

func TestImageTaskEndedTreatsDeclarativeTerminalFailureAsFinished(t *testing.T) {
	err := generation.ProtocolResultError("The generated result did not pass the content review.", "task-terminal-1")
	if !imageTaskEnded(err) {
		t.Fatal("terminal declarative image failure must not remain recoverable")
	}
}
