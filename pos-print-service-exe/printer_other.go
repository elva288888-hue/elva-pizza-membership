//go:build !windows

package main

import "sync"

var (
	testPrintMu   sync.Mutex
	testPrintText string
)

func printReceipt(_ string, text string) error {
	testPrintMu.Lock()
	testPrintText = text
	testPrintMu.Unlock()
	return nil
}
