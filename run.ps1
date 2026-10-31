# Start ShadowStop on http://localhost:8000 (reads GEMINI_API_KEY from your Windows user environment)
if (-not $env:GEMINI_API_KEY) { $env:GEMINI_API_KEY = [Environment]::GetEnvironmentVariable("GEMINI_API_KEY","User") }
python -m uvicorn shadowstop.server:app --port 8000
