$ErrorActionPreference = "Stop"

$printerName = "POS58"
$listenPort = 17891
$allowedOrigins = @(
  "https://elva-pizza-test-d1far2ax4213b224-1448876255.tcloudbaseapp.com",
  "https://elva-pizza-prod-d3f8fae10cb05aca-1448876255.tcloudbaseapp.com"
)
$pidFile = Join-Path $env:LOCALAPPDATA "AiwaPrinter\service.pid"
[System.IO.File]::WriteAllText($pidFile, [string]$PID)

$rawPrinterCode = @"
using System;
using System.Runtime.InteropServices;

public static class AiwaRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", SetLastError=true)]
    static extern bool WritePrinter(IntPtr hPrinter, IntPtr bytes, int count, out int written);

    public static void Send(string printerName, byte[] bytes) {
        IntPtr printer;
        if (!OpenPrinter(printerName, out printer, IntPtr.Zero))
            throw new InvalidOperationException("Cannot open printer: " + printerName);
        try {
            var doc = new DOCINFOA { pDocName = "Aiwa Pizza Receipt", pDataType = "RAW" };
            if (!StartDocPrinter(printer, 1, doc)) throw new InvalidOperationException("Cannot start print job");
            try {
                StartPagePrinter(printer);
                IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    int written;
                    if (!WritePrinter(printer, unmanaged, bytes.Length, out written) || written != bytes.Length)
                        throw new InvalidOperationException("Printer did not accept the complete receipt");
                } finally { Marshal.FreeCoTaskMem(unmanaged); }
                EndPagePrinter(printer);
            } finally { EndDocPrinter(printer); }
        } finally { ClosePrinter(printer); }
    }
}
"@

Add-Type -TypeDefinition $rawPrinterCode

function Send-Receipt([string]$text) {
  $encoding = [System.Text.Encoding]::GetEncoding(936)
  $content = $encoding.GetBytes($text.Replace("`r", "") + "`n`n`n`n")
  $prefix = [byte[]](0x1B, 0x40, 0x1C, 0x26)
  $bytes = New-Object byte[] ($prefix.Length + $content.Length)
  [Array]::Copy($prefix, 0, $bytes, 0, $prefix.Length)
  [Array]::Copy($content, 0, $bytes, $prefix.Length, $content.Length)
  [AiwaRawPrinter]::Send($printerName, $bytes)
}

function Write-HttpResponse($stream, [int]$status, [string]$body, [string]$origin) {
  $statusText = if ($status -eq 200) { "OK" } elseif ($status -eq 204) { "No Content" } else { "Bad Request" }
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $headers = "HTTP/1.1 $status $statusText`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bodyBytes.Length)`r`nConnection: close`r`n"
  if ($allowedOrigins -contains $origin) {
    $headers += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`n"
  }
  $headers += "`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($bodyBytes.Length -gt 0) { $stream.Write($bodyBytes, 0, $bodyBytes.Length) }
  $stream.Flush()
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $listenPort)
$listener.Start()
Write-Host "Aiwa POS58 print service started. Printer: $printerName  Address: 127.0.0.1:$listenPort"
Write-Host "Keep this window open. Press Ctrl+C to stop."

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    if (-not $requestLine) { continue }
    $headers = @{}
    while ($true) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($line)) { break }
      $separator = $line.IndexOf(":")
      if ($separator -gt 0) { $headers[$line.Substring(0, $separator).Trim().ToLower()] = $line.Substring($separator + 1).Trim() }
    }
    $origin = if ($headers.ContainsKey("origin")) { $headers["origin"] } else { "" }
    $parts = $requestLine.Split(" ")
    $method = $parts[0]
    $path = $parts[1]

    if ($method -eq "OPTIONS") {
      Write-HttpResponse $stream 204 "" $origin
    } elseif ($method -eq "GET" -and $path -eq "/health") {
      Write-HttpResponse $stream 200 "OK POS58" $origin
    } elseif ($method -eq "POST" -and $path -eq "/print" -and ($allowedOrigins -contains $origin)) {
      $length = if ($headers.ContainsKey("content-length")) { [int]$headers["content-length"] } else { 0 }
      if ($length -le 0 -or $length -gt 65536) { throw "Invalid receipt length" }
      $buffer = New-Object char[] $length
      $read = 0
      while ($read -lt $length) {
        $count = $reader.Read($buffer, $read, $length - $read)
        if ($count -le 0) { break }
        $read += $count
      }
      $encodedReceipt = New-Object string($buffer, 0, $read)
      $receipt = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedReceipt))
      Send-Receipt $receipt
      Write-HttpResponse $stream 200 "OK" $origin
    } else {
      Write-HttpResponse $stream 400 "ERROR Request not allowed" $origin
    }
  } catch {
    try { Write-HttpResponse $stream 400 "ERROR Print service error" $origin } catch {}
  } finally {
    $client.Close()
  }
}
