# VKU Field Survey

An offline-first facility survey application for the VKU campus, built with TypeScript, Vite, IndexedDB, and Capacitor.

## Features

- Offline survey storage and synchronization queue.
- Service Worker caching for offline access.
- Camera and geolocation support on Android.
- PWA and Android builds.

## Getting Started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## API Server

```bash
node server.cjs
```

Runs on port `3000` by default. Health check: `http://localhost:3000/api/health`.

Survey data is stored in `server-data/surveys.json`.

## Android

```bash
npx cap sync android
npx cap open android
```
