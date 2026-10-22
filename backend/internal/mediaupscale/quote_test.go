package mediaupscale

import "testing"

func TestQuoteVideoUsesPublishedTopazRates(t *testing.T) {
	quote, err := QuoteVideo(5_630, "1080p", "Max")
	if err != nil {
		t.Fatal(err)
	}
	if quote.UnitPriceCNYPerSecond != 0.12 || quote.ReservationCNY != 0.68 || quote.DurationSeconds != 5.63 {
		t.Fatalf("unexpected quote: %+v", quote)
	}
}

func TestQuoteVideoRejectsInvalidOrOversizeInput(t *testing.T) {
	if _, err := QuoteVideo(0, "1080p", "Max"); err == nil {
		t.Fatal("zero duration must be rejected")
	}
	if _, err := QuoteVideo(300_001, "1080p", "Max"); err == nil {
		t.Fatal("over-five-minute video must be rejected")
	}
	if err := ValidateVideo(VideoRequest{ResourceID: "video", Resolution: "8K", Quality: "Max"}); err == nil {
		t.Fatal("unsupported resolution must be rejected")
	}
}
