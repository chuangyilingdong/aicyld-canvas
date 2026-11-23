package generation

import (
	"context"
	"net/url"
	"testing"
)

func TestSeedreamV5ProReferenceURLUsesBoundedDerivative(t *testing.T) {
	resources := &maskResourcesFixture{hosted: true}
	ctx := WithRuntime(context.Background(), Runtime{Resources: resources})
	input := Input{
		Mode: "image",
		Config: Config{
			InterfaceType:    "runninghub-standard-image",
			ProviderModelKey: "seedream-v5-pro/image-to-image",
			Model:            "rh-seedream-v5-pro-i2i",
		},
		ReferenceImages: []Media{{StorageKey: "resource:reference"}},
	}
	if err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(input.ReferenceImages[0].URL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("max_edge") != "2560" || query.Get("quality") != "88" {
		t.Fatalf("optimized reference URL = %s", parsed.Redacted())
	}
}

func TestOtherImageModelsKeepOriginalReferenceURL(t *testing.T) {
	resources := &maskResourcesFixture{hosted: true}
	ctx := WithRuntime(context.Background(), Runtime{Resources: resources})
	input := Input{
		Mode:            "image",
		Config:          Config{InterfaceType: "runninghub-standard-image", ProviderModelKey: "seedream-v5.5/image-to-image"},
		ReferenceImages: []Media{{StorageKey: "resource:reference"}},
	}
	if err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(input.ReferenceImages[0].URL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("max_edge") != "" {
		t.Fatalf("unrelated image model changed reference URL: %s", parsed.Redacted())
	}
}

func TestSeedance2FastMultimodalReferenceURLUsesBoundedDerivative(t *testing.T) {
	resources := &maskResourcesFixture{hosted: true}
	ctx := WithRuntime(context.Background(), Runtime{Resources: resources})
	input := Input{
		Mode: "video",
		Config: Config{
			InterfaceType:    "runninghub-standard-video",
			ProviderModelKey: "rhart-video/sparkvideo-2.0-fast/multimodal-video",
			Model:            "rh-seedance-2.0-fast-multi",
		},
		ReferenceImages: []Media{{StorageKey: "resource:reference"}},
	}
	if err := HydrateMedia(ctx, "owner", &input, MediaHydrationPolicyFor(ctx, input)); err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(input.ReferenceImages[0].URL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("max_edge") != "2048" || query.Get("quality") != "88" {
		t.Fatalf("bounded Seedance reference URL = %s", parsed.Redacted())
	}
}
