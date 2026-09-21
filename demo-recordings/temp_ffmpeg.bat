@echo off
"C:\Users\CASA\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe" -y -f gdigrab -framerate 30 -i desktop -c:v libx264 -preset ultrafast -crf 23 -pix_fmt yuv420p -r 30 -b:v 5M "demo-recordings\bookmarkforge_automated_demo_20260921_230144.mp4"
