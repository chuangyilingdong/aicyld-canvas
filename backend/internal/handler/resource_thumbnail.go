package handler

import (
	"bytes"
	"image"
	stddraw "image/draw"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	defaultResourceThumbnailWidth = 480
	maxResourceThumbnailWidth     = 1280
	maxPublicReferenceImageEdge   = 3072
)

func normalizeResourceThumbnailWidth(value int) int {
	if value <= 0 {
		return 0
	}
	if value < 64 {
		return 64
	}
	if value > maxResourceThumbnailWidth {
		return maxResourceThumbnailWidth
	}
	return value
}

func renderResourceThumbnail(reader io.Reader, width int) ([]byte, error) {
	return renderResourcePreview(reader, width, 82)
}

func normalizePublicReferenceImageEdge(value int) int {
	if value < 512 {
		return 0
	}
	if value > maxPublicReferenceImageEdge {
		return maxPublicReferenceImageEdge
	}
	return value
}

func renderResourcePreview(reader io.Reader, maxEdge int, quality int) ([]byte, error) {
	source, _, err := image.Decode(reader)
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	sourceWidth, sourceHeight := bounds.Dx(), bounds.Dy()
	if sourceWidth <= 0 || sourceHeight <= 0 {
		return nil, image.ErrFormat
	}
	targetWidth, targetHeight := sourceWidth, sourceHeight
	if sourceWidth >= sourceHeight && sourceWidth > maxEdge {
		targetWidth = maxEdge
		targetHeight = maxInt(1, sourceHeight*maxEdge/sourceWidth)
	} else if sourceHeight > sourceWidth && sourceHeight > maxEdge {
		targetHeight = maxEdge
		targetWidth = maxInt(1, sourceWidth*maxEdge/sourceHeight)
	}
	target := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	stddraw.Draw(target, target.Bounds(), image.White, image.Point{}, stddraw.Src)
	xdraw.CatmullRom.Scale(target, target.Bounds(), source, bounds, xdraw.Over, nil)
	var output bytes.Buffer
	if quality < 1 || quality > 100 {
		quality = 82
	}
	if err := jpeg.Encode(&output, target, &jpeg.Options{Quality: quality}); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
