package outbound

import (
	"context"
	"os"
)

// ResumableResult is the legacy fully-materialized download result. New large
// artifact paths must use DownloadResumableToFile so media never enters Go heap.
type ResumableResult struct {
	Data     []byte
	MimeType string
	FileName string
}

// DownloadResumable preserves the old byte-returning API for small callers and
// tests while routing all transfer work through the file-based implementation.
func DownloadResumable(ctx context.Context, rawURL string, opts ResumableOptions) (ResumableResult, error) {
	result, err := DownloadResumableToFile(ctx, rawURL, opts)
	if err != nil {
		return ResumableResult{}, err
	}
	defer os.Remove(result.Path)
	data, err := os.ReadFile(result.Path)
	if err != nil {
		return ResumableResult{}, err
	}
	return ResumableResult{Data: data, MimeType: result.MimeType, FileName: result.FileName}, nil
}
