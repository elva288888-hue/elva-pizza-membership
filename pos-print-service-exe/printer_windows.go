//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

type docInfo1 struct {
	docName    *uint16
	outputFile *uint16
	dataType   *uint16
}

var (
	winspool             = syscall.NewLazyDLL("winspool.drv")
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	procOpenPrinterW     = winspool.NewProc("OpenPrinterW")
	procClosePrinter     = winspool.NewProc("ClosePrinter")
	procStartDocPrinterW = winspool.NewProc("StartDocPrinterW")
	procEndDocPrinter    = winspool.NewProc("EndDocPrinter")
	procStartPagePrinter = winspool.NewProc("StartPagePrinter")
	procEndPagePrinter   = winspool.NewProc("EndPagePrinter")
	procWritePrinter     = winspool.NewProc("WritePrinter")
	procWideCharToMB     = kernel32.NewProc("WideCharToMultiByte")
)

func callOK(proc *syscall.LazyProc, args ...uintptr) error {
	r1, _, callErr := proc.Call(args...)
	if r1 == 0 {
		if callErr != syscall.Errno(0) {
			return callErr
		}
		return fmt.Errorf("Windows API call failed")
	}
	return nil
}

func encodeGBK(text string) ([]byte, error) {
	wide, err := syscall.UTF16FromString(text)
	if err != nil {
		return nil, err
	}
	inputLen := len(wide) - 1
	needed, _, callErr := procWideCharToMB.Call(
		936, 0, uintptr(unsafe.Pointer(&wide[0])), uintptr(inputLen), 0, 0, 0, 0,
	)
	if needed == 0 {
		return nil, fmt.Errorf("GBK size conversion failed: %v", callErr)
	}
	output := make([]byte, int(needed))
	written, _, callErr := procWideCharToMB.Call(
		936, 0, uintptr(unsafe.Pointer(&wide[0])), uintptr(inputLen),
		uintptr(unsafe.Pointer(&output[0])), needed, 0, 0,
	)
	if written == 0 {
		return nil, fmt.Errorf("GBK conversion failed: %v", callErr)
	}
	return output[:written], nil
}

func printReceipt(name, text string) error {
	printerNameUTF16, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	var printer syscall.Handle
	if err := callOK(procOpenPrinterW, uintptr(unsafe.Pointer(printerNameUTF16)), uintptr(unsafe.Pointer(&printer)), 0); err != nil {
		return fmt.Errorf("cannot open printer %s: %w", name, err)
	}
	defer procClosePrinter.Call(uintptr(printer))

	docName, _ := syscall.UTF16PtrFromString("Aiwa Pizza Receipt")
	dataType, _ := syscall.UTF16PtrFromString("RAW")
	doc := docInfo1{docName: docName, dataType: dataType}
	jobID, _, callErr := procStartDocPrinterW.Call(uintptr(printer), 1, uintptr(unsafe.Pointer(&doc)))
	if jobID == 0 {
		return fmt.Errorf("cannot start print job: %v", callErr)
	}
	defer procEndDocPrinter.Call(uintptr(printer))

	if err := callOK(procStartPagePrinter, uintptr(printer)); err != nil {
		return fmt.Errorf("cannot start printer page: %w", err)
	}
	defer procEndPagePrinter.Call(uintptr(printer))

	gbk, err := encodeGBK(text + "\n\n\n\n")
	if err != nil {
		return err
	}
	payload := append([]byte{0x1B, 0x40, 0x1C, 0x26}, gbk...)
	var written uint32
	if err := callOK(
		procWritePrinter,
		uintptr(printer), uintptr(unsafe.Pointer(&payload[0])), uintptr(len(payload)), uintptr(unsafe.Pointer(&written)),
	); err != nil {
		return fmt.Errorf("cannot write to printer: %w", err)
	}
	if int(written) != len(payload) {
		return fmt.Errorf("printer accepted %d of %d bytes", written, len(payload))
	}
	return nil
}
