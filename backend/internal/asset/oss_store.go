package asset

import (
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

func (s *OSSBlobStore) Open(objectKey string) (*os.File, error) {
	return s.inner.Open(objectKey)
}

func (s *OSSBlobStore) Exists(objectKey string) error {
	return s.inner.Exists(objectKey)
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
