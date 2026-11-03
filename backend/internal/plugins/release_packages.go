package plugins

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/protocol"
)

// StageReleasePackage validates and stores a content-addressed package without
// changing the live registry. A release becomes executable only after the
// publication workflow explicitly installs an approved package.
func (c *Runtime) StageReleasePackage(data []byte) (string, error) {
	if c == nil {
		return "", fmt.Errorf("插件运行时未初始化")
	}
	if _, err := protocol.ParsePluginPackage(data); err != nil {
		return "", err
	}
	hash := pluginHash(data)
	path := filepath.Join(c.packageDir, blobFileName(hash))
	if _, err := ensurePluginBlob(path, data); err != nil {
		return "", fmt.Errorf("保存插件发布包失败：%w", err)
	}
	return hash, nil
}

func (c *Runtime) ReleasePackage(hash string) ([]byte, error) {
	if c == nil {
		return nil, fmt.Errorf("插件运行时未初始化")
	}
	hash = strings.TrimSpace(hash)
	if !validPackageSHA256(hash) {
		return nil, fmt.Errorf("插件包 SHA256 无效")
	}
	data, err := os.ReadFile(filepath.Join(c.packageDir, blobFileName(hash)))
	if err != nil {
		return nil, err
	}
	if pluginHash(data) != hash {
		return nil, fmt.Errorf("插件发布包内容与哈希不一致")
	}
	return data, nil
}

func (c *Runtime) DiscardReleasePackage(hash string) error {
	if c == nil {
		return fmt.Errorf("插件运行时未初始化")
	}
	hash = strings.TrimSpace(hash)
	if !validPackageSHA256(hash) {
		return fmt.Errorf("插件包 SHA256 无效")
	}
	err := os.Remove(filepath.Join(c.packageDir, blobFileName(hash)))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
