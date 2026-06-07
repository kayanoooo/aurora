# ============================================================
# Aurora Messenger — Multi-stage Dockerfile for Railway
# Builds: React client, Electron AppImage (Linux), Android APK
# Serves: FastAPI backend + static client + download artifacts
# ============================================================

# ---- Stage 1: Base Node for client build ----
FROM node:22-bookworm-slim AS node-base

WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    git \
    && rm -rf /var/lib/apt/lists/*

# ---- Stage 2: Build React client ----
FROM node-base AS client-builder

WORKDIR /build/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- Stage 3: Build Electron AppImage (Linux) ----
FROM node-base AS electron-builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY electron/ ./electron/
COPY --from=client-builder /build/client/build ./client/build

# Install electron-builder dependencies for AppImage
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libatspi2.0-0 \
    libcups2 \
    libxshmfence1 \
    libxfixes3 \
    && rm -rf /var/lib/apt/lists/*

# Build Linux AppImage (skip client build since we already have it)
RUN npx electron-builder --linux

# ---- Stage 4: Build Android APK ----
FROM node-base AS android-builder

WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY capacitor.config.ts ./
COPY android/ ./android/
COPY --from=client-builder /build/client/build ./client/build

# Install Android SDK dependencies (Java 21 from backports)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jdk-headless \
    unzip \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Java 21 for Gradle (required by capacitor-android)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* && \
    wget -q https://download.java.net/java/GA/jdk21.0.2/f2283984656d49d69e91c558476027ac/13/GPL/openjdk-21.0.2_linux-x64_bin.tar.gz -O /tmp/jdk21.tar.gz && \
    mkdir -p /opt/java && \
    tar -xzf /tmp/jdk21.tar.gz -C /opt/java && \
    rm /tmp/jdk21.tar.gz

ENV JAVA_HOME=/opt/java/jdk-21.0.2
ENV PATH=${JAVA_HOME}/bin:${PATH}

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools

# Download and install Android SDK command line tools
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d ${ANDROID_HOME}/cmdline-tools && \
    mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm /tmp/cmdline-tools.zip

# Accept licenses and install required packages
RUN yes | ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager --licenses && \
    ${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager \
    "platform-tools" \
    "platforms;android-34" \
    "build-tools;34.0.0" \
    "ndk;26.1.10909125"

# Sync capacitor (client is already built)
RUN npx cap sync android

# Make gradlew executable and build Android APK (debug for now, can be changed to release)
RUN chmod +x /build/android/gradlew && cd /build/android && ./gradlew assembleDebug

# ---- Stage 5: Python backend ----
FROM python:3.12-slim-bookworm AS python-backend

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies for Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libmariadb-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server/ /app/server/

# ---- Stage 6: Final runtime image ----
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmariadb3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from python-backend stage
COPY --from=python-backend /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=python-backend /usr/local/bin /usr/local/bin

# Copy server code
COPY --from=python-backend /app/server /app/server

# Copy built React client
COPY --from=client-builder /build/client/build /app/client/build

# Copy Electron AppImage
COPY --from=electron-builder /build/dist/*.AppImage /app/client/build/downloads/

# Copy Android APK
COPY --from=android-builder /build/android/app/build/outputs/apk/debug/app-debug.apk /app/client/build/downloads/Aurora-Android.apk

# Create uploads directory
RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --app-dir server --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]