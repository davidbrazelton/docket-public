# Makes docket.ico (16, 32, 48 and 256 pixels) from the PNGs beside it:
# docket-16.png and docket-32.png are used as they are (drawn for that size),
# and the 48 and 256 sizes are shrunk from docket-1024.png.
# Run it again after replacing any of them:  powershell -ExecutionPolicy Bypass -File icon\make-ico.ps1
Add-Type -AssemblyName System.Drawing
$here = $PSScriptRoot

function Shrink($file, $size) {
  $src = [System.Drawing.Image]::FromFile((Join-Path $here $file))
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.InterpolationMode = 'HighQualityBicubic'; $gr.PixelOffsetMode = 'HighQuality'; $gr.SmoothingMode = 'HighQuality'
  $gr.Clear([System.Drawing.Color]::Transparent)
  $gr.DrawImage($src, 0, 0, $size, $size)
  $gr.Dispose(); $src.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  , $ms.ToArray()
}

$sizes = 16, 32, 48, 256
$pngs = @(
  , [System.IO.File]::ReadAllBytes((Join-Path $here 'docket-16.png'))
  , [System.IO.File]::ReadAllBytes((Join-Path $here 'docket-32.png'))
  , (Shrink 'docket-1024.png' 48)
  , (Shrink 'docket-1024.png' 256)
)

# The .ico layout: a 6-byte header, a 16-byte entry per size, then each size's PNG.
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $n = $sizes[$i]; $b = if ($n -ge 256) { 0 } else { $n }   # 0 means 256 in an .ico
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $here 'docket.ico'), $out.ToArray())
Write-Host "Wrote $(Join-Path $here 'docket.ico') ($($sizes -join ', ') pixels)"
