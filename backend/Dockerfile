
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Build GEOtop inside the image from the official repository.
RUN git clone --branch v3.0 --depth 1 https://github.com/geotopmodel/geotop.git /opt/geotop-src \
    && mkdir -p /opt/geotop-src/cmake-build \
    && cd /opt/geotop-src/cmake-build \
    && cmake .. \
    && cmake --build . -j2 || true

COPY frontend /app/frontend
COPY backend /app/backend
COPY scripts /app/scripts
RUN mkdir -p /app/runtime/jobs

ENV GEOTOP_BIN=/opt/geotop-src/cmake-build/geotop \
    JOBS_DIR=/app/runtime/jobs

EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
