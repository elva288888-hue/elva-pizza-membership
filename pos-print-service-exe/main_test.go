package main

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	res := httptest.NewRecorder()
	handler(res, req)
	if res.Code != http.StatusOK || strings.TrimSpace(res.Body.String()) != "OK POS58" {
		t.Fatalf("unexpected health response: %d %q", res.Code, res.Body.String())
	}
}

func TestPrintFromAllowedOrigin(t *testing.T) {
	receipt := "爱娃披萨店\n订单小票\n玛格丽特披萨 ×1"
	body := base64.StdEncoding.EncodeToString([]byte(receipt))
	req := httptest.NewRequest(http.MethodPost, "/print", strings.NewReader(body))
	req.Header.Set("Origin", "https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com")
	res := httptest.NewRecorder()
	handler(res, req)
	if res.Code != http.StatusOK || strings.TrimSpace(res.Body.String()) != "OK" {
		t.Fatalf("unexpected print response: %d %q", res.Code, res.Body.String())
	}
	testPrintMu.Lock()
	defer testPrintMu.Unlock()
	if testPrintText != receipt {
		t.Fatalf("printed text mismatch: %q", testPrintText)
	}
}

func TestPrintRejectsUnknownOrigin(t *testing.T) {
	body := base64.StdEncoding.EncodeToString([]byte("test"))
	req := httptest.NewRequest(http.MethodPost, "/print", strings.NewReader(body))
	req.Header.Set("Origin", "https://example.com")
	res := httptest.NewRecorder()
	handler(res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected rejection, got %d", res.Code)
	}
}
