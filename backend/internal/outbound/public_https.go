package outbound

import (
	"context"
	"infinite-canvas/backend/internal/desktopnet"
	"net"
	"net/http"
	"net/url"
	"strings"
)

type publicHTTPSContextKey struct{}

// WithPublicHTTPS restricts managed storage targets independently of the
// user-configurable BYOK LAN policy. Explicit desktop proxies remain trusted
// network routes; their remote DNS behavior is outside this process.
func WithPublicHTTPS(ctx context.Context) context.Context {
	return context.WithValue(ctx, publicHTTPSContextKey{}, true)
}

func requiresPublicHTTPS(ctx context.Context) bool {
	value, _ := ctx.Value(publicHTTPSContextKey{}).(bool)
	return value
}

func resolvePublicHost(ctx context.Context, host string) ([]net.IP, error) {
	addresses, err := resolveOutboundHostWithPolicy(ctx, normalizeOutboundHost(host), false)
	if err != nil {
		return nil, err
	}
	for _, ip := range addresses {
		if blockedCustomRelayIP(ip) {
			return nil, BadAuthRequest("媒体地址不允许访问内网或保留地址")
		}
	}
	return addresses, nil
}

func ValidatePublicHTTPSURLContext(ctx context.Context, raw string) (*url.URL, error) {
	return validatePublicHTTPSURLContext(ctx, raw, resolvePublicHost)
}

func validatePublicHTTPSURLContext(ctx context.Context, raw string, resolve func(context.Context, string) ([]net.IP, error)) (*url.URL, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil || parsed.Fragment != "" {
		return nil, BadAuthRequest("媒体地址需要安全的 HTTPS 链接")
	}
	if _, err := resolve(ctx, parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

var (
	publicHTTPSTransport      = newOutboundTransport(resolvePublicHost)
	freshOutboundTransport    = newFreshTransport(outboundTransport)
	freshPublicHTTPSTransport = newFreshTransport(publicHTTPSTransport)
)

type freshConnectionContextKey struct{}

func WithFreshConnection(ctx context.Context) context.Context {
	return context.WithValue(ctx, freshConnectionContextKey{}, true)
}

func requiresFreshConnection(ctx context.Context) bool {
	value, _ := ctx.Value(freshConnectionContextKey{}).(bool)
	return value
}

func newFreshTransport(base *http.Transport) *http.Transport {
	cloned := base.Clone()
	cloned.DisableKeepAlives = true
	cloned.ForceAttemptHTTP2 = false
	return cloned
}

type outboundPolicyTransport struct{}

// RequestNetworkRoute describes the transport selected for diagnostics without
// exposing proxy credentials or assuming every client uses our transport.
func RequestNetworkRoute(req *http.Request, transport http.RoundTripper) string {
	proxy := desktopnet.Proxy
	switch value := transport.(type) {
	case *http.Transport:
		proxy = value.Proxy
	case outboundPolicyTransport:
	default:
		return ""
	}
	if proxy != nil {
		if selected, err := proxy(req); err == nil && selected != nil {
			return "proxy"
		}
	}
	return "direct"
}

func (outboundPolicyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	fresh := requiresFreshConnection(req.Context())
	if fresh && !req.Close {
		req = req.Clone(req.Context())
		req.Close = true
	}
	if !requiresPublicHTTPS(req.Context()) {
		if fresh {
			return freshOutboundTransport.RoundTrip(req)
		}
		return outboundTransport.RoundTrip(req)
	}
	// Validate on every dispatch, including pooled connections and redirects.
	// Direct new connections resolve once more and dial only checked IPs.
	if _, err := ValidatePublicHTTPSURLContext(req.Context(), req.URL.String()); err != nil {
		return nil, err
	}
	if fresh {
		return freshPublicHTTPSTransport.RoundTrip(req)
	}
	return publicHTTPSTransport.RoundTrip(req)
}
