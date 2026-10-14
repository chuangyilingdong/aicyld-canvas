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
	return Config{
		Endpoint:   strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_OSS_ENDPOINT")), "/"),
		Bucket:     strings.TrimSpace(os.Getenv("CANVAS_OSS_BUCKET")),
		AccessKey:  strings.TrimSpace(os.Getenv("CANVAS_OSS_ACCESS_KEY")),
		SecretKey:  strings.TrimSpace(os.Getenv("CANVAS_OSS_SECRET_KEY")),
		PathPrefix: prefix,
		SignedTTL:  ttl,
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
	expires := time.Now().Add(c.SignedTTL).Unix()
	resource := "/" + c.Bucket + "/" + key
	stringToSign := "GET\n\n\n" + fmt.Sprint(expires) + "\n" + resource
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

func logf(format string, args ...any) {
	var buffer bytes.Buffer
	fmt.Fprintf(&buffer, "[canvas-oss] "+format+"\n", args...)
	_, _ = os.Stderr.Write(buffer.Bytes())
}
