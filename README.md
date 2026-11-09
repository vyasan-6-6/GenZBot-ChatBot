# GenBot Project Foundation

Full-stack TypeScript project foundation using **Node.js**, **NPM Workspaces**, **TypeScript**, **Next.js (App Router)**, **Express**, **MongoDB (Mongoose)**, **Git**, and **GitHub**.

## Project Structure

```text
.
├── package.json            # Root npm workspace configuration and dev/build scripts
├── backend/                # Express + TypeScript + Mongoose API server (port 4000)
│   ├── .env.example
│   └── src/
│       ├── config/         # Typed env loader and MongoDB connection + ping helpers
│       ├── middleware/     # 404 & centralized error handlers
│       ├── models/         # Mongoose schemas/models
│       ├── routes/         # /api/health and /api/echo routes
│       ├── app.ts          # Express middleware & router pipeline
│       └── server.ts       # HTTP server boot & graceful shutdown
└── frontend/               # Next.js App Router frontend (port 3000)
    ├── .env.example
    └── src/
        ├── app/            # Root layout, styles, and page
        ├── components/     # Interactive FoundationDashboard client component
        └── lib/            # Typed fetch wrapper for Express API calls
```

## Prerequisites

- Node.js v20+ (tested on v22)
- npm v10+
- MongoDB Server running locally on `127.0.0.1:27017` (or a MongoDB Atlas URI in `backend/.env`)

## Setup

1. Install workspace dependencies from the repository root:

   ```bash
   npm install
   ```

2. Configure environment variables (local `.env` / `.env.local` files are already created for development, or copy from the examples):

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

3. Start both frontend and backend in development mode:

   ```bash
   npm run dev
   ```

   - Frontend: `http://localhost:3000`
   - Backend API: `http://localhost:4000`
   - Health check: `GET http://localhost:4000/api/health`

## Scripts

- `npm run dev` — Run Express (`tsx watch`) and Next.js (`next dev`) together
- `npm run dev:backend` — Run only Express backend
- `npm run dev:frontend` — Run only Next.js frontend
- `npm run typecheck` — Typecheck both backend and frontend
- `npm run build` — Compile backend TypeScript (`dist/`) and build Next.js production bundle

## Connecting to GitHub

1. Create an empty repository on GitHub (do not add README/gitignore there).
2. Add the remote and push the `main` branch:

   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

