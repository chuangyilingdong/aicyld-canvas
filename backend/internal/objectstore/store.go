// Package objectstore 把画布素材（用户上传的原片与生成结果）异步写入阿里云 OSS。
//
// 设计约定（对应实施计划第 5 项）：
//   - 本地磁盘始终是权威副本：先落盘、再异步上传，任何失败都不影响读写；
//   - 上传成功后在 data/oss-index.json 记录，重启后仍能判断对象是否存在；
//   - 读取走签名 URL 直连 OSS（短时效），未上传/未配置时自动回退本地流；
//   - 未配置 CANVAS_OSS_* 时整体关闭（Enabled()==false），行为与改造前完全一致。
package objectstore

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	// IndexFile 记录已成功上传到 OSS 的本地对象。
	IndexFile = "oss-index.json"
	// 签名 URL 默认有效期（秒）。
	defaultSignedURLTTL = 30 * time.Minute
	uploadWorkers       = 2
	uploadAttempts      = 3
	manifestVersion     = 1
)

// Config 来自环境变量；任一必填项缺失即视为未启用。
type Config struct {
	Endpoint   string
	Bucket     string
	AccessKey  string
	SecretKey  string
	PathPrefix string
	SignedTTL  time.Duration
	// LocalRetention > 0 时启用「本地副本清理」：已镜像到 OSS 且本地副本超过该时长未访问的文件会被删除，
	// 之后读取时按对象键从 OSS 回源。默认 0 = 关闭。
	LocalRetention time.Duration
}

// FromEnv 读取 CANVAS_OSS_* 配置。
func FromEnv() Config {
	prefix := strings.Trim(strings.TrimSpace(os.Getenv("CANVAS_OSS_PATH_PREFIX")), "/")
	if prefix == "" {
		prefix = "canvas"
	}
	ttl := defaultSignedURLTTL
	if raw := strings.TrimSpace(os.Getenv("CANVAS_OSS_SIGNED_TTL_MINUTES")); raw != "" {
		if minutes, err := time.ParseDuration(raw + "m"); err == nil && minutes > 0 {
			ttl = minutes
		}
	}
	retention := time.Duration(0)
	if raw := strings.TrimSpace(os.Getenv("CANVAS_OSS_LOCAL_RETENTION_HOURS")); raw != "" {
		if hours, err := time.ParseDuration(raw + "h"); err == nil && hours > 0 {
			retention = hours
		}
	}
	return Config{
		Endpoint:       strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_OSS_ENDPOINT")), "/"),
		Bucket:         strings.TrimSpace(os.Getenv("CANVAS_OSS_BUCKET")),
		AccessKey:      strings.TrimSpace(os.Getenv("CANVAS_OSS_ACCESS_KEY")),
		SecretKey:      strings.TrimSpace(os.Getenv("CANVAS_OSS_SECRET_KEY")),
		PathPrefix:     prefix,
		SignedTTL:      ttl,
		LocalRetention: retention,
	}
}

// Configured 报告配置是否完整。
func (c Config) Configured() bool {
	return c.Endpoint != "" && c.Bucket != "" && c.AccessKey != "" && c.SecretKey != ""
}

func (c Config) host() string {
	return strings.TrimPrefix(strings.TrimPrefix(c.Endpoint, "https://"), "http://")
}

// objectURL 返回 bucket 三级域名下的对象地址。
func (c Config) objectURL(key string) string {
	return fmt.Sprintf("https://%s.%s/%s", c.Bucket, c.host(), escapeKey(key))
}

func (c Config) remoteKey(localKey string) string {
	clean := strings.TrimLeft(strings.TrimSpace(localKey), "/")
	if c.PathPrefix == "" {
		return clean
	}
	return c.PathPrefix + "/" + clean
}

func escapeKey(key string) string {
	segments := strings.Split(strings.TrimLeft(key, "/"), "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}

// 阿里云 OSS V1 签名：Authorization = "OSS <key>:<base64(hmac-sha1(stringToSign))>"。
func (c Config) authorization(method, contentType, date, resource string) string {
	stringToSign := method + "\n" + "" + "\n" + contentType + "\n" + date + "\n" + resource
	mac := hmac.New(sha1.New, []byte(c.SecretKey))
	mac.Write([]byte(stringToSign))
	return "OSS " + c.AccessKey + ":" + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

func (c Config) signedGetURL(key string) string {
	return c.signedURL(http.MethodGet, key)
}

// signedURL 生成 OSS V1 签名地址（GET / HEAD 均可）。
func (c Config) signedURL(method, key string) string {
	expires := time.Now().Add(c.SignedTTL).Unix()
	resource := "/" + c.Bucket + "/" + key
	stringToSign := method + "\n\n\n" + fmt.Sprint(expires) + "\n" + resource
	mac := hmac.New(sha1.New, []byte(c.SecretKey))
	mac.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("%s?OSSAccessKeyId=%s&Expires=%d&Signature=%s",
		c.objectURL(key), url.QueryEscape(c.AccessKey), expires, url.QueryEscape(signature))
}

type manifest struct {
	Version int                       `json:"version"`
	Objects map[string]manifestRecord `json:"objects"`
}

type manifestRecord struct {
	Size       int64  `json:"size"`
	UploadedAt string `json:"uploadedAt"`
}

// Store 绑定一个画布数据目录：队列 + 已上传索引。
type Store struct {
	config   Config
	path     string
	dataRoot string

	mu       sync.Mutex
	uploaded map[string]manifestRecord
	loaded   bool
	queue    chan uploadTask
	once     sync.Once
	client   *http.Client

	// restoreMu 串行化「回源下载」与「本地清理」，避免边下边删。
	restoreMu sync.Mutex
}

type uploadTask struct {
	localPath string
	remoteKey string
}

var (
	storeMu   sync.Mutex
	storeByID = map[string]*Store{}
)

// New 返回绑定 dataDir 的存储（同目录共享实例，便于读取上传索引）。
func New(dataDir string) *Store {
	root := strings.TrimSpace(dataDir)
	if root == "" {
		return &Store{config: Config{}}
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		absolute = filepath.Clean(root)
	}
	absolute = filepath.Clean(absolute)
	storeMu.Lock()
	defer storeMu.Unlock()
	if existing, ok := storeByID[absolute]; ok {
		return existing
	}
	store := &Store{
		config:   FromEnv(),
		path:     filepath.Join(absolute, IndexFile),
		dataRoot: absolute,
		uploaded: map[string]manifestRecord{},
		client:   &http.Client{Timeout: 30 * time.Minute},
	}
	if store.config.Configured() {
		store.queue = make(chan uploadTask, 256)
		// 本地副本清理：默认关闭（CANVAS_OSS_LOCAL_RETENTION_HOURS 未设置时为 0）。
		store.StartLocalCopySweeper(store.config.LocalRetention, time.Hour)
	}
	storeByID[absolute] = store
	return store
}

// Enabled 报告 OSS 是否可用。
func (s *Store) Enabled() bool {
	return s != nil && s.config.Configured()
}

// DataDir 返回数据目录（本地对象根目录的父目录）。
func (s *Store) DataDir() string {
	if s == nil {
		return ""
	}
	return s.dataRoot
}

// Schedule 把已落盘的本地对象排入异步上传队列（非阻塞）。
func (s *Store) Schedule(objectKey string, localPath string, size int64) {
	if !s.Enabled() || strings.TrimSpace(objectKey) == "" || strings.TrimSpace(localPath) == "" {
		return
	}
	if s.Uploaded(objectKey) {
		return
	}
	s.startWorkers()
	task := uploadTask{localPath: localPath, remoteKey: s.config.remoteKey(objectKey)}
	select {
	case s.queue <- task:
	default:
		// 队列满时不阻塞业务写入：由下一次写入或巡检补传。
		go s.upload(task)
	}
}

// Uploaded 报告本地对象是否已经在 OSS。
func (s *Store) Uploaded(objectKey string) bool {
	if !s.Enabled() {
		return false
	}
	s.loadOnce()
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.uploaded[s.config.remoteKey(objectKey)]
	return ok
}

// SignedURL 返回直连 OSS 的短时效签名地址；未上传时返回 false。
func (s *Store) SignedURL(objectKey string) (string, bool) {
	if !s.Uploaded(objectKey) {
		return "", false
	}
	return s.config.signedGetURL(s.config.remoteKey(objectKey)), true
}

// Delete 删除 OSS 对象（本地删除后调用；失败仅记录，不阻塞业务）。
func (s *Store) Delete(objectKey string) {
	if !s.Enabled() {
		return
	}
	remoteKey := s.config.remoteKey(objectKey)
	s.forget(objectKey)
	request, err := http.NewRequest(http.MethodDelete, s.config.objectURL(remoteKey), nil)
	if err != nil {
		return
	}
	request.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	request.Header.Set("Authorization", s.config.authorization(http.MethodDelete, "", request.Header.Get("Date"), "/"+s.config.Bucket+"/"+remoteKey))
	response, err := s.client.Do(request)
	if err != nil {
		logf("删除 OSS 对象 %s 失败: %v", remoteKey, err)
		return
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode >= 300 && response.StatusCode != http.StatusNotFound {
		logf("删除 OSS 对象 %s 返回 %d", remoteKey, response.StatusCode)
	}
}

func (s *Store) startWorkers() {
	s.once.Do(func() {
		for index := 0; index < uploadWorkers; index++ {
			go func() {
				for task := range s.queue {
					s.upload(task)
				}
			}()
		}
	})
}

func (s *Store) upload(task uploadTask) {
	var lastErr error
	for attempt := 0; attempt < uploadAttempts; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt*attempt) * 2 * time.Second)
		}
		size, err := s.putObject(task)
		if err == nil {
			s.remember(task.remoteKey, size)
			return
		}
		lastErr = err
		if errors.Is(err, os.ErrNotExist) {
			// 本地对象已删除，没必要重试。
			return
		}
	}
	logf("上传 OSS 对象 %s 失败（保留本地副本）: %v", task.remoteKey, lastErr)
}

func (s *Store) putObject(task uploadTask) (int64, error) {
	file, err := os.Open(task.localPath)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0, err
	}
	contentType := contentTypeFor(task.remoteKey)
	request, err := http.NewRequest(http.MethodPut, s.config.objectURL(task.remoteKey), file)
	if err != nil {
		return 0, err
	}
	request.ContentLength = info.Size()
	request.Header.Set("Date", time.Now().UTC().Format(http.TimeFormat))
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Authorization", s.config.authorization(http.MethodPut, contentType, request.Header.Get("Date"), "/"+s.config.Bucket+"/"+task.remoteKey))
	response, err := s.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("OSS 返回 %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	return info.Size(), nil
}

func contentTypeFor(key string) string {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	default:
		return "application/octet-stream"
	}
}

func (s *Store) loadOnce() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return
	}
	s.loaded = true
	body, err := os.ReadFile(s.path)
	if err != nil {
		return
	}
	var decoded manifest
	if json.Unmarshal(body, &decoded) != nil || decoded.Objects == nil {
		return
	}
	s.uploaded = decoded.Objects
}

func (s *Store) remember(remoteKey string, size int64) {
	s.mu.Lock()
	s.uploaded[remoteKey] = manifestRecord{Size: size, UploadedAt: time.Now().UTC().Format(time.RFC3339)}
	snapshot := manifest{Version: manifestVersion, Objects: make(map[string]manifestRecord, len(s.uploaded))}
	for key, record := range s.uploaded {
		snapshot.Objects[key] = record
	}
	s.mu.Unlock()
	s.persist(snapshot)
}

func (s *Store) forget(objectKey string) {
	s.mu.Lock()
	delete(s.uploaded, s.config.remoteKey(objectKey))
	snapshot := manifest{Version: manifestVersion, Objects: make(map[string]manifestRecord, len(s.uploaded))}
	for key, record := range s.uploaded {
		snapshot.Objects[key] = record
	}
	s.mu.Unlock()
	s.persist(snapshot)
}

func (s *Store) persist(snapshot manifest) {
	body, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	body = append(body, '\n')
	directory := filepath.Dir(s.path)
	temporary, err := os.CreateTemp(directory, ".oss-index-*")
	if err != nil {
		logf("写入 OSS 索引失败: %v", err)
		return
	}
	name := temporary.Name()
	defer os.Remove(name)
	_ = temporary.Chmod(0o600)
	if _, err := temporary.Write(body); err != nil {
		_ = temporary.Close()
		logf("写入 OSS 索引失败: %v", err)
		return
	}
	_ = temporary.Sync()
	_ = temporary.Close()
	if err := os.Rename(name, s.path); err != nil {
		logf("替换 OSS 索引失败: %v", err)
	}
}

// localObjectKey 校验并归一化本地对象键（拒绝绝对路径与目录穿越）。
func localObjectKey(objectKey string) (string, error) {
	trimmed := strings.TrimSpace(objectKey)
	native := filepath.FromSlash(trimmed)
	clean := filepath.Clean(native)
	if trimmed == "" || clean == "." || clean == ".." || !filepath.IsLocal(native) || !filepath.IsLocal(clean) {
		return "", errors.New("local object key is invalid")
	}
	return clean, nil
}

// localKey 把 OSS 上的完整键还原为本地对象键（去掉 PathPrefix）。
func (c Config) localKey(remoteKey string) string {
	trimmed := strings.TrimLeft(strings.TrimSpace(remoteKey), "/")
	if c.PathPrefix != "" {
		prefix := c.PathPrefix + "/"
		if !strings.HasPrefix(trimmed, prefix) {
			return ""
		}
		trimmed = strings.TrimPrefix(trimmed, prefix)
	}
	clean, err := localObjectKey(trimmed)
	if err != nil {
		return ""
	}
	return clean
}

func (s *Store) localPath(objectKey string) string {
	return filepath.Join(s.dataRoot, "resources", objectKey)
}

// LocalCopyExists 报告本地副本是否还在（用于回源判断）。
func (s *Store) LocalCopyExists(objectKey string) bool {
	if !s.Enabled() {
		return false
	}
	clean, err := localObjectKey(objectKey)
	if err != nil {
		return false
	}
	info, statErr := os.Stat(s.localPath(clean))
	return statErr == nil && !info.IsDir()
}

// Restore 在本地副本已被清理时，按对象键从 OSS 回源到标准本地路径并返回该路径。
func (s *Store) Restore(objectKey string) (string, error) {
	if !s.Enabled() {
		return "", errors.New("object storage is not enabled")
	}
	clean, err := localObjectKey(objectKey)
	if err != nil {
		return "", err
	}
	if !s.Uploaded(clean) {
		return "", fmt.Errorf("对象 %s 不在 OSS 索引中", clean)
	}
	target := s.localPath(clean)
	s.restoreMu.Lock()
	defer s.restoreMu.Unlock()
	if info, statErr := os.Stat(target); statErr == nil && !info.IsDir() {
		return target, nil
	}
	remoteKey := s.config.remoteKey(clean)
	if err := s.downloadObject(remoteKey, target); err != nil {
		return "", err
	}
	logf("已从 OSS 回源本地副本 %s", clean)
	return target, nil
}

func (s *Store) downloadObject(remoteKey, target string) error {
	response, err := s.client.Get(s.config.signedGetURL(remoteKey))
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("OSS 回源 %s 返回 %d: %s", remoteKey, response.StatusCode, strings.TrimSpace(string(body)))
	}
	directory := filepath.Dir(target)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".beeftv-restore-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	_ = temporary.Chmod(0o640)
	written, err := io.Copy(temporary, response.Body)
	if err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if expected, ok := s.recordedSize(remoteKey); ok && expected > 0 && written != expected {
		return fmt.Errorf("OSS 回源 %s 大小不符：%d != %d", remoteKey, written, expected)
	}
	return os.Rename(name, target)
}

func (s *Store) recordedSize(remoteKey string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.uploaded[remoteKey]
	if !ok {
		return 0, false
	}
	return record.Size, true
}

func (s *Store) headObject(remoteKey string) (bool, error) {
	request, err := http.NewRequest(http.MethodHead, s.config.signedURL(http.MethodHead, remoteKey), nil)
	if err != nil {
		return false, err
	}
	response, err := s.client.Do(request)
	if err != nil {
		return false, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	if response.StatusCode == http.StatusNotFound {
		return false, nil
	}
	if response.StatusCode >= 300 {
		return false, fmt.Errorf("OSS HEAD %s 返回 %d", remoteKey, response.StatusCode)
	}
	return true, nil
}

// SweepLocalCopies 删除「已镜像到 OSS、本地副本超过保留期未更新」的本地文件。
// 远端校验失败、网络异常、删除失败一律跳过——宁可留副本，也不影响读写。
func (s *Store) SweepLocalCopies(retention time.Duration) (int, int64) {
	if !s.Enabled() || retention <= 0 {
		return 0, 0
	}
	s.loadOnce()
	s.mu.Lock()
	keys := make([]string, 0, len(s.uploaded))
	for key := range s.uploaded {
		keys = append(keys, key)
	}
	s.mu.Unlock()
	removed := 0
	freed := int64(0)
	for _, remoteKey := range keys {
		objectKey := s.config.localKey(remoteKey)
		if objectKey == "" {
			continue
		}
		target := s.localPath(objectKey)
		info, err := os.Stat(target)
		if err != nil || info.IsDir() {
			continue
		}
		if time.Since(info.ModTime()) < retention {
			continue
		}
		exists, err := s.headObject(remoteKey)
		if err != nil || !exists {
			continue
		}
		s.restoreMu.Lock()
		removeErr := os.Remove(target)
		s.restoreMu.Unlock()
		if removeErr != nil {
			continue
		}
		removed++
		freed += info.Size()
	}
	return removed, freed
}

// StartLocalCopySweeper 后台定期清理本地副本；retention <= 0 时不启动（默认行为）。
func (s *Store) StartLocalCopySweeper(retention, interval time.Duration) {
	if !s.Enabled() || retention <= 0 {
		return
	}
	if interval <= 0 {
		interval = time.Hour
	}
	logf("本地副本清理已启用：保留 %s，每 %s 巡检一次", retention, interval)
	go func() {
		timer := time.NewTicker(interval)
		defer timer.Stop()
		for range timer.C {
			if removed, freed := s.SweepLocalCopies(retention); removed > 0 {
				logf("本地副本清理：删除 %d 个对象，释放 %d 字节", removed, freed)
			}
		}
	}()
}

func logf(format string, args ...any) {
	var buffer bytes.Buffer
	fmt.Fprintf(&buffer, "[canvas-oss] "+format+"\n", args...)
	_, _ = os.Stderr.Write(buffer.Bytes())
}
