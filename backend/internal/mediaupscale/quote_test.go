package mediaupscale

import "testing"

func TestQuoteVideoUsesPublishedTopazRates(t *testing.T) {
	quote, err := QuoteTopaz(5_630, "1080p", "Max")
	if err != nil {
		t.Fatal(err)
	}
	if quote.UnitPriceCNYPerSecond != 0.12 || quote.ReservationCNY != 0.68 || quote.DurationSeconds != 5.63 {
		t.Fatalf("unexpected quote: %+v", quote)
	}
}

func TestFixedUpscaleModels(t *testing.T) {
	for _, id := range []string{VOSR2ImageModel, VOSR2VideoModel, FlashVSRVideoModel} {
		model, ok := FindModel(id)
		if !ok {
			t.Fatalf("missing model %s", id)
		}
		quote, err := QuoteModel(model, 5_000, 854, 480)
		if err != nil {
			t.Fatal(err)
		}
		if quote.ReservationCNY != model.FixedPriceCNY {
			t.Fatalf("unexpected fixed quote for %s: %+v", id, quote)
		}
	}
}

func TestQuoteVideoRejectsInvalidOrOversizeInput(t *testing.T) {
	if _, err := QuoteTopaz(0, "1080p", "Max"); err == nil {
		t.Fatal("zero duration must be rejected")
	}
	if _, err := QuoteTopaz(300_001, "1080p", "Max"); err == nil {
		t.Fatal("over-five-minute video must be rejected")
	}
	if _, _, err := NormalizeRequest(Request{Model: TopazVideoModel, ResourceID: "video", Resolution: "8K", Quality: "Max"}); err == nil {
		t.Fatal("unsupported resolution must be rejected")
	}
}
