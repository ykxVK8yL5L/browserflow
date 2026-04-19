# FROM node:20-bookworm-slim AS frontend-builder

# WORKDIR /app/frontend

# COPY frontend/package.json frontend/pnpm-lock.yaml ./

# RUN corepack enable \
# 	&& corepack prepare pnpm@latest --activate \
# 	&& pnpm install --frozen-lockfile

# COPY frontend/ ./

# RUN pnpm build


FROM python:3.11-slim-bookworm AS runtime


WORKDIR /app/backend

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		curl \
		ca-certificates \
		fonts-liberation \
		libasound2 \
		libatk-bridge2.0-0 \
		libatk1.0-0 \
		libc6 \
		libcairo2 \
		libcups2 \
		libdbus-1-3 \
		libdrm2 \
		libgbm1 \
		libglib2.0-0 \
		libgtk-3-0 \
		libnspr4 \
		libnss3 \
		libpango-1.0-0 \
		libx11-6 \
		libx11-xcb1 \
		libxcb1 \
		libxcomposite1 \
		libxdamage1 \
		libxext6 \
		libxfixes3 \
		libxrandr2 \
		xvfb \
		xauth \
		xdg-utils \
	&& rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt

RUN pip install --upgrade pip \
	&& pip install -r requirements.txt \
	&& python -m playwright install chromium --with-deps

COPY backend/ ./
#COPY --from=frontend-builder /app/frontend/ ../frontend/
#COPY --from=frontend-builder /app/backend/public ./public

RUN mkdir -p data/files data/identities data/screenshots data/credentials

VOLUME ["/app/backend/data"]

EXPOSE 8000

HEALTHCHECK --interval=300s --timeout=10s --start-period=30s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=5)"

CMD ["sh", "-c", "exec xvfb-run -a --server-args='-screen 0 1920x1080x24 -ac +extension RANDR' uvicorn main:app --host 0.0.0.0 --port 8000"]
