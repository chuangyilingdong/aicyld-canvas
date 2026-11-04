package handler

import (
	"encoding/json"
	"net/http"

	"infinite-canvas/backend/internal/app"

	"github.com/gin-gonic/gin"
)

func RegisterPointsRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/points/wallet", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.PointsWallet(c.Request.Context(), user.ID)
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.GET("/points/ledger", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.PointsLedger(c.Request.Context(), user.ID, c.Request.URL.RawQuery)
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.GET("/points/summary", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.PointsSummary(c.Request.Context(), user.ID)
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.GET("/points/plans", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.PointsPlans(c.Request.Context(), user.ID)
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.GET("/points/order/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.GetPointsOrder(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.POST("/points/order", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var body map[string]any
		if err := c.ShouldBindJSON(&body); err != nil { fail(c, http.StatusBadRequest, err); return }
		raw, err := svc.CreatePointsOrder(c.Request.Context(), user.ID, body)
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.POST("/points/pay/wxpay", func(c *gin.Context) { pointsPayment(c, svc, true) })
	r.POST("/points/pay/alipay", func(c *gin.Context) { pointsPayment(c, svc, false) })
	r.GET("/points/pay/wxpay/query/:outTradeNo", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.QueryPointsWxpay(c.Request.Context(), user.ID, c.Param("outTradeNo"))
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
	r.GET("/points/pay/alipay/status", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil { failService(c, err); return }
		raw, err := svc.QueryPointsAlipay(c.Request.Context(), user.ID, c.Query("outTradeNo"))
		if err != nil { failService(c, err); return }
		okRaw(c, raw)
	})
}

func pointsPayment(c *gin.Context, svc *app.Service, wxpay bool) {
	user, err := currentUser(c, svc)
	if err != nil { failService(c, err); return }
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	var body struct { OrderID string `json:"orderId"` }
	if err := c.ShouldBindJSON(&body); err != nil || body.OrderID == "" { fail(c, http.StatusBadRequest, err); return }
	var raw json.RawMessage
	if wxpay {
		raw, err = svc.CreatePointsWxpay(c.Request.Context(), user.ID, body.OrderID)
	} else {
		raw, err = svc.CreatePointsAlipayQr(c.Request.Context(), user.ID, body.OrderID)
	}
	if err != nil { failService(c, err); return }
	var payment struct { CodeURL string `json:"codeUrl"`; QRCode string `json:"qrCode"`; OutTradeNo string `json:"outTradeNo"` }
	if err := json.Unmarshal(raw, &payment); err != nil { failService(c, err); return }
	value := payment.CodeURL
	if value == "" { value = payment.QRCode }
	if value == "" { fail(c, http.StatusBadGateway, nil); return }
	qr, err := svc.GeneratePointsQR(c.Request.Context(), value)
	if err != nil { failService(c, err); return }
	var qrData struct { DataURL string `json:"dataUrl"` }
	if err := json.Unmarshal(qr, &qrData); err != nil { failService(c, err); return }
	ok(c, map[string]any{"outTradeNo": payment.OutTradeNo, "codeUrl": payment.CodeURL, "qrCode": payment.QRCode, "qrDataUrl": qrData.DataURL})
}

func okRaw(c *gin.Context, raw json.RawMessage) {
	var data any
	if err := json.Unmarshal(raw, &data); err != nil { failService(c, err); return }
	ok(c, data)
}
