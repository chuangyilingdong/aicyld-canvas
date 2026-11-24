package generation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/protocol"

	"golang.org/x/sync/singleflight"
)

const (
	runningHubMediaUploadPath = "/openapi/v2/media/upload/binary"
	// Official RunningHub upload links are valid for about one day. Refresh
	// well before that upper bound instead of treating them as durable storage.
	runningHubMediaCacheTTL = 12 * time.Hour
)

type runningHubMediaURLCache struct {
	mu      sync.Mutex
	entries map[string]runningHubMediaURLCacheEntry
}

type runningHubMediaURLCacheEntry struct {
	downloadURL string
	expiresAt   time.Time
}

var (
	runningHubURLCache = runningHubMediaURLCache{entries: map[string]runningHubMediaURLCacheEntry{}}
	runningHubURLLoads singleflight.Group
)

func isRunningHubStandardInterface(interfaceType string) bool {
	switch strings.TrimSpace(interfaceType) {
	case "runninghub-standard-image", "runninghub-standard-video", "runninghub-standard-audio":
		return true
	default:
		return false
	}
}

func runningHubUploadPolicy(config Config) *RunningHubUploadPolicy {
	if !isRunningHubStandardInterface(config.InterfaceType) {
		return nil
	}
	return &RunningHubUploadPolicy{
		BaseURL: runningHubMediaRootURL(config.BaseURL),
		APIKey:  firstNonEmpty(config.RunningHubUploadKey, config.APIKey),
		Headers: append([]outbound.OutboundHeader(nil), config.Headers...),
	}
}

func runningHubMediaRootURL(value string) string {
	root := strings.TrimRight(strings.TrimSpace(value), "/")
	if root == "" {
		root = "https://www.runninghub.cn"
	}
	lower := strings.ToLower(root)
	for _, suffix := range []string{"/openapi/v2", "/openapi"} {
		if strings.HasSuffix(lower, suffix) {
			return strings.TrimRight(root[:len(root)-len(suffix)], "/")
		}
	}
	return root
}

func runningHubUploadReferenceURL(ctx context.Context, policy RunningHubUploadPolicy, media Media, data []byte, mimeType string) (string, error) {
	if strings.TrimSpace(policy.APIKey) == "" {
		return "", errors.New("RunningHub 参考素材上传缺少 API Key")
	}
	mimeType = strings.ToLower(NormalizedMediaMIMEType(mimeType, data))
	if err := validateRunningHubReferenceBytes(media, mimeType, data); err != nil {
		return "", err
	}
	root := runningHubMediaRootURL(policy.BaseURL)
	site := runningHubUploadSite(root)
	digest := sha256.Sum256(data)
	cacheKey := hex.EncodeToString(digest[:]) + "\x00" + mimeType + "\x00" + site
	if cached, ok := runningHubURLCache.lookup(cacheKey); ok {
		return cached, nil
	}
	result := runningHubURLLoads.DoChan(cacheKey, func() (any, error) {
		if cached, ok := runningHubURLCache.lookup(cacheKey); ok {
			return cached, nil
		}
		downloadURL, err := uploadRunningHubReferenceWithRetry(ctx, root, policy, media, digest, mimeType, data)
		if err != nil {
			return "", err
		}
		runningHubURLCache.store(cacheKey, downloadURL)
		return downloadURL, nil
	})
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case loaded := <-result:
		if loaded.Err != nil {
			return "", loaded.Err
		}
		downloadURL, ok := loaded.Val.(string)
		if !ok || strings.TrimSpace(downloadURL) == "" {
			return "", errors.New("RunningHub 上传响应缺少 download_url")
		}
		return downloadURL, nil
	}
}

func uploadRunningHubReferenceWithRetry(ctx context.Context, root string, policy RunningHubUploadPolicy, media Media, digest [sha256.Size]byte, mimeType string, data []byte) (string, error) {
	const maxAttempts = 2
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		downloadURL, err := uploadRunningHubReference(ctx, root, policy, media, digest, mimeType, data)
		if err == nil {
			return downloadURL, nil
		}
		lastErr = err
		if attempt == maxAttempts || ctx.Err() != nil || !ClassifyError(err).Retryable {
			break
		}
		delay := 250 * time.Millisecond
		if retryAfter := ProviderRetryAfter(err); retryAfter > 0 && retryAfter < 5*time.Second {
			delay = retryAfter
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
	}
	return "", lastErr
}

func uploadRunningHubReference(ctx context.Context, root string, policy RunningHubUploadPolicy, media Media, digest [sha256.Size]byte, mimeType string, data []byte) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	filename := "reference-" + hex.EncodeToString(digest[:8]) + runningHubMediaExtension(mimeType)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	requestURL, err := ProtocolRequestURL(root, protocolRequestSpec(runningHubMediaUploadPath))
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(WithRequestKind(ctx, "reference_upload"), http.MethodPost, requestURL, bytes.NewReader(body.Bytes()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	outbound.ApplyOutboundHeaders(req, policy.Headers)
	// The official media contract authenticates this endpoint with the
	// account key, so a generic channel header cannot replace the bearer value.
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(policy.APIKey))
	responseBody, _, err := DoBinary(req)
	if err != nil {
		return "", err
	}
	var response struct {
		Code int `json:"code"`
		Data struct {
			DownloadURL string `json:"download_url"`
			Size        any    `json:"size"`
			MIMEType    string `json:"mimeType"`
			MIMETypeAlt string `json:"mime_type"`
			Type        string `json:"type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &response); err != nil {
		return "", errors.New("RunningHub 上传响应不是有效 JSON")
	}
	if response.Code != 0 {
		return "", fmt.Errorf("RunningHub 上传响应失败（code=%d）", response.Code)
	}
	downloadURL := strings.TrimSpace(response.Data.DownloadURL)
	parsed, err := url.Parse(downloadURL)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("RunningHub 上传响应缺少有效 HTTPS download_url")
	}
	if size, ok := runningHubResponseSize(response.Data.Size); ok && size != int64(len(data)) {
		return "", errors.New("RunningHub 上传返回的文件大小与本地素材不一致")
	}
	returnedMIME := firstNonEmpty(response.Data.MIMETypeAlt, response.Data.MIMEType, response.Data.Type)
	if returnedMIME != "" {
		returnedMIME = strings.ToLower(strings.TrimSpace(strings.Split(returnedMIME, ";")[0]))
		if returnedMIME != mimeType {
			return "", errors.New("RunningHub 上传返回的文件类型与本地素材不一致")
		}
	}
	return downloadURL, nil
}

func protocolRequestSpec(path string) protocol.RequestSpec {
	return protocol.RequestSpec{OriginPath: true, Path: path}
}

func validateRunningHubReferenceBytes(media Media, mimeType string, data []byte) error {
	if len(data) == 0 {
		return errors.New("RunningHub 参考素材为空")
	}
	if strings.EqualFold(media.Kind(), "image") || strings.HasPrefix(mimeType, "image/") {
		switch mimeType {
		case "image/jpeg", "image/png", "image/webp":
		default:
			return fmt.Errorf("RunningHub 参考图片格式不受支持：%s", mimeType)
		}
		return ValidateImageArtifact(data, mimeType)
	}
	return nil
}

func (m Media) Kind() string {
	if strings.TrimSpace(m.Type) != "" {
		return strings.TrimSpace(m.Type)
	}
	if strings.HasPrefix(strings.ToLower(m.MimeType), "image/") {
		return "image"
	}
	if strings.HasPrefix(strings.ToLower(m.MimeType), "video/") {
		return "video"
	}
	if strings.HasPrefix(strings.ToLower(m.MimeType), "audio/") {
		return "audio"
	}
	return ""
}

func runningHubUploadSite(root string) string {
	parsed, err := url.Parse(strings.TrimSpace(root))
	if err != nil || parsed.Host == "" {
		return strings.TrimRight(strings.TrimSpace(root), "/")
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host)
}

func runningHubMediaExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "video/mp4":
		return ".mp4"
	case "video/webm":
		return ".webm"
	case "video/quicktime":
		return ".mov"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav":
		return ".wav"
	case "audio/ogg":
		return ".ogg"
	case "audio/mp4":
		return ".m4a"
	case "audio/flac":
		return ".flac"
	default:
		return ".bin"
	}
}

func runningHubResponseSize(value any) (int64, bool) {
	switch typed := value.(type) {
	case string:
		var size int64
		if _, err := fmt.Sscan(strings.TrimSpace(typed), &size); err == nil && size >= 0 {
			return size, true
		}
	case float64:
		if typed >= 0 {
			return int64(typed), true
		}
	case json.Number:
		size, err := typed.Int64()
		return size, err == nil && size >= 0
	}
	return 0, false
}

func (c *runningHubMediaURLCache) lookup(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return "", false
	}
	if !time.Now().Before(entry.expiresAt) {
		delete(c.entries, key)
		return "", false
	}
	return entry.downloadURL, true
}

func (c *runningHubMediaURLCache) store(key, downloadURL string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for existingKey, entry := range c.entries {
		if !now.Before(entry.expiresAt) {
			delete(c.entries, existingKey)
		}
	}
	c.entries[key] = runningHubMediaURLCacheEntry{downloadURL: downloadURL, expiresAt: now.Add(runningHubMediaCacheTTL)}
}

func resetRunningHubMediaURLCacheForTest() {
	runningHubURLCache.mu.Lock()
	runningHubURLCache.entries = map[string]runningHubMediaURLCacheEntry{}
	runningHubURLCache.mu.Unlock()
}
