package asset

import (
	"errors"
	"io"
	"os"

	"infinite-canvas/backend/internal/objectstore"
)

// ResourceSigner 是 BlobStore 的可选能力：把本地对象换成对象存储的短时效直连地址。
// 读取路径通过类型断言探测，未启用对象存储时行为与改造前完全一致。
type ResourceSigner interface {
	SignedURL(objectKey string) (string, bool)
}

// OSSBlobStore 在本地 FileStore 之上异步镜像到对象存储：
// 本地磁盘仍是唯一权威副本，上传失败只影响后续的直连读取，不影响读写正确性。
type OSSBlobStore struct {
	inner *FileStore
	store *objectstore.Store
}

// NewOSSFileStore 在配置了 CANVAS_OSS_* 时返回镜像存储，否则返回本地 FileStore。
func NewOSSFileStore(dataDir string) BlobStore {
	inner := NewFileStore(dataDir)
	store := objectstore.New(dataDir)
	if !store.Enabled() {
		return inner
	}
	return &OSSBlobStore{inner: inner, store: store}
}

func (s *OSSBlobStore) Write(objectKey string, body io.Reader) error {
	if err := s.inner.Write(objectKey, body); err != nil {
		return err
	}
	path, err := s.inner.path(objectKey)
	if err != nil {
		return nil
	}
	if info, statErr := os.Stat(path); statErr == nil && !info.IsDir() {
		s.store.Schedule(objectKey, path, info.Size())
	}
	return nil
}

// Open 打开本地对象；本地副本已被清理时按对象键从 OSS 回源后再打开。
// 回源失败一律回落到原始错误，不改变「对象不存在」的语义。
func (s *OSSBlobStore) Open(objectKey string) (*os.File, error) {
	file, err := s.inner.Open(objectKey)
	if err == nil {
		return file, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	path, restoreErr := s.store.Restore(objectKey)
	if restoreErr != nil {
		return nil, err
	}
	return os.Open(path)
}

// Exists 报告对象是否可读：本地缺失但已镜像到 OSS 时同样视为可读（Open 会回源）。
func (s *OSSBlobStore) Exists(objectKey string) error {
	err := s.inner.Exists(objectKey)
	if err == nil || !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if s.store.Uploaded(objectKey) {
		return nil
	}
	return err
}

// Delete 先删本地再删远端：远端删除失败只记录日志，不阻塞资源删除。
func (s *OSSBlobStore) Delete(objectKey string) error {
	err := s.inner.Delete(objectKey)
	s.store.Delete(objectKey)
	return err
}

// SignedURL 暴露给读取路径：对象已在 OSS 时返回签名直连地址。
func (s *OSSBlobStore) SignedURL(objectKey string) (string, bool) {
	return s.store.SignedURL(objectKey)
}
