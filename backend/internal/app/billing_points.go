package app

import (
	"context"
	"encoding/json"
	"errors"

	"infinite-canvas/backend/internal/billing"
)

func (s *Service) billingPointsClient() (*billing.Client, error) {
	if s == nil || s.billing == nil || !s.billing.Enabled() {
		return nil, errors.New("主站积分服务未配置")
	}
	return s.billing, nil
}

func (s *Service) PointsWallet(ctx context.Context, userID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.PointsWallet(ctx, userID)
}

func (s *Service) PointsLedger(ctx context.Context, userID, rawQuery string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.PointsLedger(ctx, userID, rawQuery)
}

func (s *Service) PointsSummary(ctx context.Context, userID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.PointsSummary(ctx, userID)
}

func (s *Service) PointsPlans(ctx context.Context, userID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.PointsPlans(ctx, userID)
}

func (s *Service) GetPointsOrder(ctx context.Context, userID, orderID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.GetPointsOrder(ctx, userID, orderID)
}

func (s *Service) CreatePointsOrder(ctx context.Context, userID string, body any) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.CreatePointsOrder(ctx, userID, body)
}

func (s *Service) CreatePointsWxpay(ctx context.Context, userID, orderID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.CreatePointsWxpay(ctx, userID, orderID)
}

func (s *Service) CreatePointsAlipayQr(ctx context.Context, userID, orderID string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.CreatePointsAlipayQr(ctx, userID, orderID)
}

func (s *Service) QueryPointsWxpay(ctx context.Context, userID, outTradeNo string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.QueryPointsWxpay(ctx, userID, outTradeNo)
}

func (s *Service) QueryPointsAlipay(ctx context.Context, userID, outTradeNo string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.QueryPointsAlipay(ctx, userID, outTradeNo)
}

func (s *Service) GeneratePointsQR(ctx context.Context, value string) (json.RawMessage, error) {
	client, err := s.billingPointsClient()
	if err != nil { return nil, err }
	return client.GenerateQR(ctx, value)
}
