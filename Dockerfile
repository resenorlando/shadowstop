# ShadowStop: FastAPI verifier + static web app in one container.
# Build:  docker build -t shadowstop .
# Run:    docker run -p 8000:8000 -e GEMINI_API_KEY=... shadowstop
# GEMINI_API_KEY is read at runtime from the environment; it is never baked into the image.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# PORT is honoured so the image runs unchanged on Cloud Run / Render / Fly.
CMD ["sh", "-c", "uvicorn shadowstop.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
