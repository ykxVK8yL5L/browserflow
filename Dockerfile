# FROM node:20-bookworm-slim AS frontend-builder

# WORKDIR /app/frontend

# COPY frontend/package.json frontend/pnpm-lock.yaml ./

# RUN corepack enable \
# 	&& corepack prepare pnpm@latest --activate \
# 	&& pnpm install --frozen-lockfile

# COPY frontend/ ./

# RUN pnpm build


FROM python:3.12-slim AS runtime


WORKDIR /app/backend


RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libxkbcommon0 libatspi2.0-0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libx11-xcb1 libfontconfig1 libx11-6 \
    libxcb1 libxext6 libxshmfence1 \
    libglib2.0-0 libgtk-3-0 libpangocairo-1.0-0 libcairo-gobject2 \
    libgdk-pixbuf-2.0-0 libxss1 libxtst6 fonts-liberation \
    fonts-noto-color-emoji fonts-unifont fonts-freefont-ttf \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf \
    xvfb xauth xdg-utils xdotool \
    curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt

RUN pip install --upgrade pip \
	&& pip install -r requirements.txt 

COPY backend/ ./
#COPY --from=frontend-builder /app/frontend/ ../frontend/
#COPY --from=frontend-builder /app/backend/public ./public

RUN mkdir -p data/files data/identities data/screenshots data/credentials

VOLUME ["/app/backend/data"]

EXPOSE 8000

HEALTHCHECK --interval=300s --timeout=10s --start-period=30s --retries=3 \
	CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=5)"

CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -ac +extension RANDR & export DISPLAY=:99 && exec uvicorn main:app --host 0.0.0.0 --port 8000"]
