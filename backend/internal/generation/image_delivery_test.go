package generation

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestValidateImageArtifactRejectsErrorDocuments(t *testing.T) {
	if err := ValidateImageArtifact([]byte(`{"error":"quota exceeded"}`), "application/json"); err == nil {
		t.Fatal("JSON error document accepted as image")
	}
	if err := ValidateImageArtifact([]byte("upstream error"), "text/plain"); err == nil {
		t.Fatal("text error document accepted as image")
	}
	png, err := base64.StdEncoding.DecodeString(strings.SplitN("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", ",", 2)[1])
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateImageArtifact(png, "image/png"); err != nil {
		t.Fatalf("valid image rejected: %v", err)
	}
}
