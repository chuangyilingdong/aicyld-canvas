package bootstrap

import "testing"

func TestApplicationServiceModeFollowsRuntimeProfile(t *testing.T) {
	if svc := newApplicationService(nil, t.TempDir(), ProfileServer); svc.IsLocalMode() {
		t.Fatal("server profile must use hosted service boundaries")
	}
	if svc := newApplicationService(nil, t.TempDir(), ProfileDesktop); !svc.IsLocalMode() {
		t.Fatal("desktop profile must use local service boundaries")
	}
}
