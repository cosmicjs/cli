# Cosmic CLI API Architecture

This document outlines which services the CLI connects to and when each is used.

> **Important**: Any functionality that can be done with the Cosmic SDK should be done with it. Only use DAPI for operations not available in the SDK (authentication, project management, etc.).

## Services Overview

The CLI connects to **two** services:

| Service | Base URL | Purpose |
|---------|----------|---------|
| **DAPI** (Dashboard API) | `https://dapi.cosmicjs.com/v3` | Admin operations, authentication, project/bucket management |
| **Cosmic API** (via SDK) | `https://api.cosmicjs.com/v3` | Content operations via Cosmic SDK |

> **Important**: The CLI does NOT connect directly to `cosmic-api` codebase. It uses the Cosmic SDK which calls the official Cosmic API.

## When to Use Each Service

### DAPI (Dashboard API) - `cosmic-backend`

**Used for admin/dashboard operations:**

- Authentication (login, logout, token validation)
- Workspaces (list, get)
- Projects (list, get, create, archive)
- Buckets (get bucket details, API keys)
- Object Types - Use SDK (`sdk.objectTypes.find()`, `sdk.objectTypes.insertOne()`)
- Agents (list, get, create, update, delete, run)
- Workflows (list, get, create, update, delete, execute)
- AI Models (list available models)

**Implementation**: `src/api/client.ts` and `src/api/dashboard.ts`

**Configuration**:
```env
COSMIC_DAPI_URL=https://dapi.cosmicjs.com/v3  # or http://localhost:3000/v3 for local
COSMIC_API_ENV=production                      # or staging
```

### Cosmic API (via SDK) - `cosmic-sdk-js`

**Used for content operations:**

- Object Types (list, get, create, update, delete)
- Objects (list, get, create, update, delete, publish, unpublish)
- Media (list, get, upload, delete)
- AI Text Generation (chat, generate text)
- AI Image Generation
- AI Video Generation

**Implementation**: `src/api/sdk.ts` using `@cosmicjs/sdk`

**Configuration**:
```env
# API Environment: "production" (default) or "staging"
COSMIC_API_ENV=production
```

The SDK uses `apiEnvironment` to determine the API endpoint:
```typescript
const cosmic = createBucketClient({
  bucketSlug: 'BUCKET_SLUG',
  readKey: 'BUCKET_READ_KEY',
  writeKey: 'BUCKET_WRITE_KEY',
  apiEnvironment: 'production' // or 'staging'
});
```

See: https://www.cosmicjs.com/docs/api/object-types

## API Endpoint Mapping

### DAPI Endpoints (via `dashboard.ts`)

```
Authentication:
  POST /users/authenticate          → Login
  GET  /users/get                   → Get current user

Workspaces:
  GET  /workspaces/list            → List workspaces
  GET  /workspaces/get             → Get workspace

Projects:
  GET  /projects/list              → List projects
  GET  /projects/get               → Get project

Buckets:
  GET  /buckets/get                → Get bucket (with ?slug=)

Object Types:
  Use SDK instead - see Workers Endpoints below

Agents:
  GET    /ai/agents                → List agents
  GET    /ai/agents/{id}           → Get agent
  POST   /ai/agents                → Create agent
  PATCH  /ai/agents/{id}           → Update agent
  DELETE /ai/agents/{id}           → Delete agent
  POST   /ai/agents/{id}/run       → Run agent

Workflows:
  GET    /ai/workflows             → List workflows
  GET    /ai/workflows/{id}        → Get workflow
  POST   /ai/workflows             → Create workflow
  PATCH  /ai/workflows/{id}        → Update workflow
  DELETE /ai/workflows/{id}        → Delete workflow
  POST   /ai/workflows/{id}/execute → Execute workflow

AI Models:
  GET  /ai/models                  → List available models
```

### Cosmic API Endpoints (via SDK)

```
Object Types:
  GET    /buckets/{slug}/object-types      → sdk.objectTypes.find()
  GET    /buckets/{slug}/object-types/:slug → sdk.objectTypes.findOne()
  POST   /buckets/{slug}/object-types      → sdk.objectTypes.insertOne()
  PATCH  /buckets/{slug}/object-types/:slug → sdk.objectTypes.updateOne()
  DELETE /buckets/{slug}/object-types/:slug → sdk.objectTypes.deleteOne()

Objects:
  GET    /buckets/{slug}/objects   → sdk.objects.find()
  GET    /buckets/{slug}/objects   → sdk.objects.findOne()
  POST   /buckets/{slug}/objects   → sdk.objects.insertOne()
  PATCH  /buckets/{slug}/objects   → sdk.objects.updateOne()
  DELETE /buckets/{slug}/objects   → sdk.objects.deleteOne()

Media:
  GET    /buckets/{slug}/media     → sdk.media.find()
  POST   /buckets/{slug}/media     → sdk.media.insertOne()
  DELETE /buckets/{slug}/media     → sdk.media.deleteOne()

AI:
  POST   /buckets/{slug}/ai/text   → sdk.ai.generateText()
  POST   /buckets/{slug}/ai/image  → sdk.ai.generateImage()
  POST   /buckets/{slug}/ai/video  → sdk.ai.generateVideo()
```

See: https://www.cosmicjs.com/docs/api/object-types#create-an-object-type

## Authentication Flow

1. **Login** → DAPI (`/users/authenticate`) → Returns JWT token
2. **Token stored** → `~/.cosmic/credentials.json`
3. **DAPI requests** → Use JWT in `Authorization: Bearer <token>` header
4. **SDK requests** → Use bucket's `write_key` in `Authorization: Bearer <key>` header

## Local Development

For local development, configure these environment variables in `.env`:

```env
# Point DAPI to local cosmic-backend
COSMIC_DAPI_URL=http://localhost:3000/v3

# API Environment for SDK (uses Cosmic's hosted API)
COSMIC_API_ENV=staging

# Enable debug logging
COSMIC_DEBUG=1
```

**Note**: The SDK always uses the hosted Cosmic API (`api.cosmicjs.com`). Set `COSMIC_API_ENV=staging` to use staging data.

## Code Structure

```
src/
├── api/
│   ├── client.ts      # HTTP client for DAPI (axios-based)
│   ├── dashboard.ts   # DAPI endpoint functions
│   └── sdk.ts         # Cosmic SDK wrapper for Workers
├── auth/
│   └── manager.ts     # Authentication (uses DAPI)
├── chat/
│   ├── repl.ts        # Chat mode (uses SDK for AI, DAPI for admin)
│   ├── tools.ts       # Tool definitions
│   └── handlers.ts    # Tool handlers (uses both DAPI and SDK)
└── commands/
    ├── objects.ts     # Object commands (uses SDK)
    ├── media.ts       # Media commands (uses SDK)
    ├── agents.ts      # Agent commands (uses DAPI)
    ├── workflows.ts   # Workflow commands (uses DAPI)
    └── config.ts      # Config/models commands (uses DAPI)
```

## SDK-First Principle

**Always prefer the Cosmic SDK over DAPI when both can accomplish the same task.**

The SDK (`@cosmicjs/sdk`) is the official public API and should be used for:
- All content operations (objects, media, object types)
- AI features (text, image, video generation)
- Any operation documented at https://www.cosmicjs.com/docs/api

Only use DAPI for operations NOT available in the SDK:
- User authentication (login/logout)
- Project management
- Workspace management
- Agent/Workflow management (dashboard-specific features)

## Summary

| Operation | Service | Client |
|-----------|---------|--------|
| Login/Auth | DAPI | `client.ts` |
| Projects/Buckets | DAPI | `dashboard.ts` |
| Object Types | Cosmic API | `sdk.ts` (SDK) |
| Agents/Workflows | DAPI | `dashboard.ts` |
| AI Models list | DAPI | `dashboard.ts` |
| Objects CRUD | Cosmic API | `sdk.ts` (SDK) |
| Media CRUD | Cosmic API | `sdk.ts` (SDK) |
| AI Generation | Cosmic API | `sdk.ts` (SDK) |
