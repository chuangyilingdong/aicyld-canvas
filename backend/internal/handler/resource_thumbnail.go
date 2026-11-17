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
	if sourceWidth >= sourceHeight && sourceWidth > width {
		targetWidth = width
		targetHeight = maxInt(1, sourceHeight*width/sourceWidth)
	} else if sourceHeight > sourceWidth && sourceHeight > width {
		targetHeight = width
		targetWidth = maxInt(1, sourceWidth*width/sourceHeight)
	}
	target := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	stddraw.Draw(target, target.Bounds(), image.White, image.Point{}, stddraw.Src)
	xdraw.CatmullRom.Scale(target, target.Bounds(), source, bounds, xdraw.Over, nil)
	var output bytes.Buffer
	if err := jpeg.Encode(&output, target, &jpeg.Options{Quality: 82}); err != nil {
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
