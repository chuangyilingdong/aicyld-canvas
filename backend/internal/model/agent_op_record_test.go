package model

import (
	"bytes"
	"strings"
	"testing"
)

func TestAgentOpResultCompressionRoundTrip(t *testing.T) {
	raw := []byte(`{"items":"` + strings.Repeat("large-receipt-", 4096) + `"}`)
	value, encoding, err := EncodeAgentOpResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if encoding != AgentOpResultEncodingGzipBase64 || !strings.HasPrefix(value, agentOpResultCompressedPrefix) {
		t.Fatalf("large result was not compressed: encoding=%q prefix=%v", encoding, strings.HasPrefix(value, agentOpResultCompressedPrefix))
	}
	if len(value) >= len(raw)/2 {
		t.Fatalf("compression did not reduce receipt enough: raw=%d encoded=%d", len(raw), len(value))
	}
	decoded, err := DecodeAgentOpResult(value, encoding)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, raw) {
		t.Fatal("decoded result differs from input")
	}
}

func TestAgentOpSmallResultStaysPlainText(t *testing.T) {
	raw := []byte(`{"ok":true}`)
	value, encoding, err := EncodeAgentOpResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	if encoding != "" || value != string(raw) {
		t.Fatalf("small result changed: encoding=%q value=%q", encoding, value)
	}
	decoded, err := DecodeAgentOpResult(value, encoding)
	if err != nil || !bytes.Equal(decoded, raw) {
		t.Fatalf("plain result decode failed: %q %v", decoded, err)
	}
}

func TestAgentOpCompressedPrefixDecodesWithoutEncodingColumn(t *testing.T) {
	raw := []byte(strings.Repeat("x", 40000))
	value, _, err := EncodeAgentOpResult(raw)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeAgentOpResult(value, "")
	if err != nil || !bytes.Equal(decoded, raw) {
		t.Fatalf("prefix-only decode failed: %v", err)
	}
}
