package handler

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestRenderResourceThumbnailScalesLongEdgeAndEncodesJPEG(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 800, 400))
	for y := 0; y < 400; y++ {
		for x := 0; x < 800; x++ {
			source.Set(x, y, color.RGBA{R: 220, G: 40, B: 40, A: 255})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	thumbnail, err := renderResourceThumbnail(bytes.NewReader(encoded.Bytes()), 200)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(thumbnail))
	if err != nil {
		t.Fatal(err)
	}
	if got := decoded.Bounds().Dx(); got != 200 {
		t.Fatalf("thumbnail width = %d, want 200", got)
	}
	if got := decoded.Bounds().Dy(); got != 100 {
		t.Fatalf("thumbnail height = %d, want 100", got)
	}
}

func TestNormalizeResourceThumbnailWidthBounds(t *testing.T) {
	cases := map[int]int{-1: 0, 0: 0, 1: 64, 480: 480, 5000: 1280}
	for input, want := range cases {
		if got := normalizeResourceThumbnailWidth(input); got != want {
			t.Fatalf("normalizeResourceThumbnailWidth(%d) = %d, want %d", input, got, want)
		}
	}
}
