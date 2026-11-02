package asset

import "testing"

func TestOSSFallbackObjectKey(t *testing.T) {
	t.Setenv("CANVAS_OSS_PATH_PREFIX", "/canvas/")
	if got := ossObjectKey("/users/owner/image/file.png"); got != "canvas/users/owner/image/file.png" {
		t.Fatalf("ossObjectKey=%q", got)
	}
	t.Setenv("CANVAS_OSS_PATH_PREFIX", "")
	if got := ossObjectKey("users/owner/video/file.mp4"); got != "users/owner/video/file.mp4" {
		t.Fatalf("ossObjectKey without prefix=%q", got)
	}
}

func TestParseOSSByteRange(t *testing.T) {
	cases := []struct {
		name      string
		value     string
		size      int64
		start     int64
		end       int64
		wantValid bool
	}{
		{"closed", "bytes=10-19", 100, 10, 19, true},
		{"open end", "bytes=90-", 100, 90, 99, true},
		{"suffix", "bytes=-10", 100, 90, 99, true},
		{"clamp end", "bytes=90-200", 100, 90, 99, true},
		{"start past end", "bytes=100-", 100, 0, 0, false},
		{"bad end", "bytes=20-10", 100, 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end, ok := parseOSSByteRange(tc.value, tc.size)
			if ok != tc.wantValid || start != tc.start || end != tc.end {
				t.Fatalf("parseOSSByteRange(%q,%d)=(%d,%d,%v), want (%d,%d,%v)", tc.value, tc.size, start, end, ok, tc.start, tc.end, tc.wantValid)
			}
		})
	}
}
