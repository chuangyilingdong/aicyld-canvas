package asset

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/aliyun/aliyun-oss-go-sdk/oss"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

var (
	ossFallbackOnce sync.Once
	ossFallback     *oss.Bucket
	ossFallbackErr  error
)

var errOSSFallbackUnavailable = errors.New("object storage fallback unavailable")

func loadOSSFallback() (*oss.Bucket, error) {
	ossFallbackOnce.Do(func() {
		endpoint := strings.TrimSpace(os.Getenv("CANVAS_OSS_ENDPOINT"))
		bucketName := strings.TrimSpace(os.Getenv("CANVAS_OSS_BUCKET"))
		accessKey := strings.TrimSpace(os.Getenv("CANVAS_OSS_ACCESS_KEY"))
		secretKey := strings.TrimSpace(os.Getenv("CANVAS_OSS_SECRET_KEY"))
		if endpoint == "" || bucketName == "" || accessKey == "" || secretKey == "" {
			ossFallbackErr = errOSSFallbackUnavailable
			return
		}
		client, err := oss.New(endpoint, accessKey, secretKey)
		if err != nil {
			ossFallbackErr = kernel.NewAppError(http.StatusBadGateway, "对象存储初始化失败，请稍后重试")
			return
		}
		bucket, err := client.Bucket(bucketName)
		if err != nil {
			ossFallbackErr = kernel.NewAppError(http.StatusBadGateway, "对象存储存储桶不可用，请稍后重试")
			return
		}
		ossFallback = bucket
	})
	return ossFallback, ossFallbackErr
}

func ossObjectKey(objectKey string) string {
	prefix := strings.Trim(strings.TrimSpace(os.Getenv("CANVAS_OSS_PATH_PREFIX")), "/")
	key := strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if prefix == "" {
		return key
	}
	return prefix + "/" + key
}

func (s *Service) openOSSResourceRange(resource *model.Resource, rangeHeader string) (*ResourceStream, error) {
	bucket, err := loadOSSFallback()
	if err != nil {
		return nil, err
	}
	if resource == nil || strings.TrimSpace(resource.ObjectKey) == "" {
		return nil, ResourceFileMissing()
	}
	key := ossObjectKey(resource.ObjectKey)
	meta, err := bucket.GetObjectMeta(key)
	if err != nil {
		return nil, ossReadError(err)
	}
	size, err := strconv.ParseInt(strings.TrimSpace(meta.Get("Content-Length")), 10, 64)
	if err != nil || size < 0 {
		size = resource.Size
	}
	if resource.MimeType == "" {
		resource.MimeType = strings.TrimSpace(meta.Get("Content-Type"))
	}
	normalized := NormalizeSingleByteRange(rangeHeader)
	if normalized == "" {
		body, err := bucket.GetObject(key)
		if err != nil {
			return nil, ossReadError(err)
		}
		return &ResourceStream{
			Resource: resource, Body: body, StatusCode: http.StatusOK,
			ContentLength: size, AcceptRanges: "bytes",
		}, nil
	}
	start, end, ok := parseOSSByteRange(normalized, size)
	if !ok {
		return &ResourceStream{
			Resource: resource, Body: http.NoBody, StatusCode: http.StatusRequestedRangeNotSatisfiable,
			ContentRange: fmt.Sprintf("bytes */%d", size), AcceptRanges: "bytes",
		}, nil
	}
	body, err := bucket.GetObject(key, oss.Range(start, end))
	if err != nil {
		return nil, ossReadError(err)
	}
	return &ResourceStream{
		Resource: resource, Body: body, StatusCode: http.StatusPartialContent,
		ContentLength: end - start + 1,
		ContentRange:  fmt.Sprintf("bytes %d-%d/%d", start, end, size),
		AcceptRanges:  "bytes",
	}, nil
}

func ossReadError(err error) error {
	var serviceErr oss.ServiceError
	if errors.As(err, &serviceErr) && serviceErr.StatusCode == http.StatusNotFound {
		return ResourceFileMissing()
	}
	return kernel.NewAppError(http.StatusBadGateway, "对象存储读取失败，请稍后重试")
}

func parseOSSByteRange(normalized string, size int64) (int64, int64, bool) {
	spec := strings.TrimPrefix(normalized, "bytes=")
	startText, endText, found := strings.Cut(spec, "-")
	if !found || size <= 0 {
		return 0, 0, false
	}
	var start, end int64
	if strings.TrimSpace(startText) == "" {
		n, err := strconv.ParseInt(strings.TrimSpace(endText), 10, 64)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	}
	start, err := strconv.ParseInt(strings.TrimSpace(startText), 10, 64)
	if err != nil || start < 0 || start >= size {
		return 0, 0, false
	}
	end = size - 1
	if strings.TrimSpace(endText) != "" {
		end, err = strconv.ParseInt(strings.TrimSpace(endText), 10, 64)
		if err != nil || end < start {
			return 0, 0, false
		}
		if end >= size {
			end = size - 1
		}
	}
	return start, end, true
}
