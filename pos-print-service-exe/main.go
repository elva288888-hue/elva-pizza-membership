package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

const (
	listenAddress = "127.0.0.1:17891"
	printerName   = "POS58"
	maxBodyBytes  = 65536
)

var allowedOrigins = map[string]bool{
	"https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com": true,
	"https://elva-pizza-prod-d3f8fae10cb05aca-1448876255.tcloudbaseapp.com": true,
}

func setCORS(w http.ResponseWriter, origin string) {
	if !allowedOrigins[origin] {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")
}

func handler(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	setCORS(w, origin)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	if r.Method == http.MethodOptions {
		if !allowedOrigins[origin] {
			http.Error(w, "ERROR Request not allowed", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method == http.MethodGet && r.URL.Path == "/health" {
		_, _ = io.WriteString(w, "OK POS58")
		return
	}

	if r.Method != http.MethodPost || r.URL.Path != "/print" || !allowedOrigins[origin] {
		http.Error(w, "ERROR Request not allowed", http.StatusBadRequest)
		return
	}

	encoded, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil || len(encoded) == 0 || len(encoded) > maxBodyBytes {
		http.Error(w, "ERROR Invalid receipt", http.StatusBadRequest)
		return
	}
	receipt, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(encoded)))
	if err != nil || len(receipt) == 0 {
		http.Error(w, "ERROR Invalid receipt", http.StatusBadRequest)
		return
	}

	if err := printReceipt(printerName, string(receipt)); err != nil {
		log.Printf("print failed: %v", err)
		http.Error(w, "ERROR Print failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = io.WriteString(w, "OK")
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime)
	log.Printf("Aiwa POS58 print service started")
	log.Printf("Printer: %s", printerName)
	log.Printf("Address: http://%s", listenAddress)
	log.Printf("Keep this window open")
	if err := http.ListenAndServe(listenAddress, http.HandlerFunc(handler)); err != nil {
		fmt.Fprintf(os.Stderr, "Service stopped: %v\n", err)
		fmt.Fprintln(os.Stderr, "Press Enter to close")
		_, _ = fmt.Scanln()
		os.Exit(1)
	}
}
