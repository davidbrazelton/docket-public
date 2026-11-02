# Makes the icons for installing Docket as an app (manifest.webmanifest) from docket-1024.png:
# docket-192.png and docket-512.png are the scroll shrunk as it is, and docket-maskable-512.png
# puts it smaller on a solid square, so Windows and phones can crop it to a circle or rounded
# square without cutting the scroll (the middle 80% is what always shows).
# Run it again after replacing docket-1024.png:  powershell -ExecutionPolicy Bypass -File icon\make-app-icons.ps1
Add-Type -AssemblyName System.Drawing
$here = $PSScriptRoot

function Draw($out, $size, $scale, $background) {
  $src = [System.Drawing.Image]::FromFile((Join-Path $here 'docket-1024.png'))
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.InterpolationMode = 'HighQualityBicubic'; $gr.PixelOffsetMode = 'HighQuality'; $gr.SmoothingMode = 'HighQuality'
  $gr.Clear($background)
  $inner = [int]($size * $scale); $at = [int](($size - $inner) / 2)
  $gr.DrawImage($src, $at, $at, $inner, $inner)
  $gr.Dispose(); $src.Dispose()
  $bmp.Save((Join-Path $here $out), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}

$clear = [System.Drawing.Color]::Transparent
Draw 'docket-192.png' 192 1 $clear
Draw 'docket-512.png' 512 1 $clear
Draw 'docket-maskable-512.png' 512 0.66 ([System.Drawing.ColorTranslator]::FromHtml('#f7f6f3')) # the page's light background
