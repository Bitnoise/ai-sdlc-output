# htn-login Architecture

This document describes the technical design, components, data flow, security model, and deployment approach of the htn-login authentication system.

## System Overview

htn-login is a full-stack authentication system built with TypeScript and Express. It provides user registration, login, and session management with PostgreSQL as the persistence layer. The system enforces security best practices including password hashing, session regeneration, HTTPS-only cookies, and HTML escaping to prevent XSS.

**Core Purpose**: Enable secure user authentication with server-side session management and stateless REST API compatibility.

## Component Architecture

### 1. Server Entry Point (`server.ts`)

- **Responsibility**: Application bootstrap and lifecycle management
- **Workflow**:
  1. Reads `PORT` environment variable (defaults to 3000)
  2. Runs database migrations on startup
  3. Starts Express server listening on the configured port
  4. Exits process with error if migration fails (ensures database is ready before accepting requests)

### 2. Application Layer (`app.ts`)

Configures Express middleware and defines all HTTP routes and business logic.

**Key Middleware**:
- `trust proxy`: Enables secure cookie handling behind reverse proxies (Render, Railway, Fly)
- `urlencoded`: Parses form-encoded request bodies
- `express-session`: Manages session state with PostgreSQL backend

**Session Configuration**:
- Secret: Loaded from `SESSION_SECRET` environment variable (required)
- Store: PostgreSQL via `connect-pg-simple`
- Expiration: 7 days (`maxAge: 7 * 24 * 60 * 60 * 1000`)
- Cookies: HTTP-only, SameSite=lax, secure (HTTPS-only in production)
- Session pruning: Automatic cleanup every 15 minutes (disabled in test environment)

**Core Routes**:
- `GET /` — Home page (requires authentication)
- `GET /login` — Login form (redirects authenticated users to home)
- `POST /login` — Process login credentials
- `GET /register` — Registration form (redirects authenticated users to home)
- `POST /register` — Process registration
- `POST /logout` — Destroy session and redirect to login
- `GET /health` — Health check endpoint (no authentication required)

**Authentication Helpers**:
- `readCredentials()`: Extracts, normalizes, and validates email/password from request
- `logIn()`: Regenerates session ID and sets user context (prevents session fixation attacks)
- `requireGuest()`: Middleware that redirects authenticated users away from login/register

### 3. Database Layer (`db.ts`)

Manages PostgreSQL connection and database operations.

**Connection**:
- Uses `pg` Pool for connection pooling
- Connection string: `DATABASE_URL` environment variable (required)
- SSL configuration: Enabled via `DATABASE_SSL=true` for external providers (Neon, Supabase, Render external URLs)

**Migrations**:
- Runs on server startup (idempotent, uses `CREATE TABLE IF NOT EXISTS`)
- Creates two tables: `users` and `session`

**Database Schema**:

```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE session (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX idx_session_expire ON session (expire);
```

**User Query Functions**:
- `findUserByEmail(email)`: Retrieves user by email (case-insensitive lookup, stored as lowercase)
- `findUserById(id)`: Retrieves user by ID for session hydration
- `createUser(email, passwordHash)`: Inserts new user; returns undefined if email already exists (via `ON CONFLICT DO NOTHING`)

### 4. View Layer (`views.ts`)

Server-side HTML template generation for all pages.

**HTML Security**:
- `escapeHtml()`: Escapes `&`, `<`, `>`, `"`, `'` to prevent XSS
- Applied to all user-controlled content: email prefill, error messages, username display

**Templates**:
- `layout()`: Base HTML structure with responsive CSS grid layout, dark/light color scheme
- `authForm()`: Reusable form template for login/register with error display
- `loginPage()`: Login form with link to registration
- `registerPage()`: Registration form with link to login
- `homePage()`: Authenticated user welcome page with logout button

**CSS Features**:
- Responsive design with viewport meta tags
- System font stack for performance
- Tailwind-inspired utility color palette
- Focus state indicators for accessibility

## Data Flow

### Registration Flow

1. **GET /register** → Serve registration form (guest-only)
2. **POST /register** with email and password:
   - Read and normalize credentials (trim, lowercase email)
   - Validate email format with regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
   - Validate password length (≥ 8 characters)
   - Hash password with bcryptjs (cost factor: 12)
   - Insert into `users` table via `createUser()`
   - On success: Regenerate session → Set `userId` → Redirect to home
   - On email conflict: Return 409 with error message
   - On validation error: Return 400 with specific error message

### Login Flow

1. **GET /login** → Serve login form (guest-only)
2. **POST /login** with email and password:
   - Read and normalize credentials
   - Query database for user by email
   - Use bcryptjs to compare provided password against stored hash
   - If user not found OR password invalid: Return 401 with ambiguous error message
   - If valid: Regenerate session → Set `userId` → Redirect to home

### Session/Authentication Flow

1. **User accesses any protected route**:
   - Express session middleware deserializes session from PostgreSQL
   - `req.session.userId` is populated if session exists and is valid
2. **Home page (`GET /`)**:
   - If `req.session.userId` exists: Query user by ID, display welcome page
   - If not authenticated: Redirect to login
3. **Logout (`POST /logout`)**:
   - Destroy session record in database
   - Clear session cookie
   - Redirect to login

## Security Model

### Password Security

- **Hashing Algorithm**: bcryptjs with cost factor 12
- **No Plain Text Storage**: Password hashes stored; plain passwords never logged or persisted
- **Strong Password Requirement**: Minimum 8 characters enforced at registration

### Session Security

- **Server-Side Sessions**: Session state stored in database, not client cookies
- **Session Regeneration**: On login, `req.session.regenerate()` is called to prevent session fixation attacks
- **Session Expiration**: Default 7-day TTL; automatic cleanup via database pruning
- **Secure Cookies**: 
  - HTTP-only flag prevents JavaScript access
  - SameSite=lax prevents CSRF in most scenarios
  - Secure flag enforced in production (HTTPS-only)

### Input Validation

- **Email Validation**: Regex pattern checks for basic email format
- **Password Validation**: Length check (≥8) prevents weak passwords
- **HTML Escaping**: All user-supplied data escaped before rendering to prevent XSS

### Authentication Ambiguity

- **Unified Error Messages**: Login endpoint returns "Wrong email or password" for both invalid email and wrong password, preventing user enumeration attacks

### HTTPS Enforcement

- **Production**: `NODE_ENV=production` sets secure cookies to HTTPS-only
- **Proxy Support**: `trust proxy` setting allows secure cookies behind load balancers
- **Local Development**: `NODE_ENV=development` allows HTTP for localhost testing

### Database SSL

- **External Providers**: `DATABASE_SSL=true` enables SSL/TLS for hosted databases (Neon, Supabase)
- **Local Development**: SSL disabled by default for local PostgreSQL

## API Routes

| Method | Path | Auth Required | Purpose |
|--------|------|---------------|---------|
| GET | `/` | Yes | Home page (authenticated user welcome) |
| GET | `/login` | No (guest-only) | Login form |
| POST | `/login` | No (guest-only) | Process login credentials |
| GET | `/register` | No (guest-only) | Registration form |
| POST | `/register` | No (guest-only) | Process registration |
| POST | `/logout` | Yes (optional) | Destroy session |
| GET | `/health` | No | Health check for monitoring |

**Status Codes**:
- `200`: Successful page render
- `302`: Redirect (successful login/registration, or guest redirect)
- `400`: Validation error (invalid email or password too short)
- `401`: Authentication error (wrong password or unknown email)
- `409`: Conflict (email already registered)
- `500`: Server error (unhandled exception)

## Database Schema Details

### `users` Table

- **id** (SERIAL PRIMARY KEY): Unique user identifier, auto-increment
- **email** (TEXT NOT NULL UNIQUE): Unique email address, stored lowercase
- **password_hash** (TEXT NOT NULL): bcryptjs hash (starts with `$2a$`, `$2b$`, or `$2y$`)
- **created_at** (TIMESTAMPTZ NOT NULL DEFAULT now()): Account creation timestamp

**Indexes**: Implicit index on `id` (primary key); implicit index on `email` (unique constraint)

### `session` Table

- **sid** (VARCHAR NOT NULL PRIMARY KEY): Session ID (secure random string)
- **sess** (JSON NOT NULL): Serialized session object containing `userId`, etc.
- **expire** (TIMESTAMP(6) NOT NULL): Expiration timestamp
- **Indexes**: `idx_session_expire` on `expire` column for efficient pruning

## Testing Strategy

Tests use an isolated test database (`TEST_DATABASE_URL`) to avoid affecting development data.

**Test Coverage**:
- **Authentication**: Registration, login, logout, session management
- **Validation**: Email format, password length, duplicate emails
- **Security**: Password hashing verification, HTML escaping, XSS prevention
- **Routing**: Guest-only redirects, authentication checks, health endpoint

**Test Database Isolation**:
- `beforeAll()`: Run migrations to create tables
- `beforeEach()`: Truncate users and session tables for test isolation
- `afterAll()`: Close database connection pool

## Deployment Model

### Local Development

- **Runtime**: Node.js ≥20 with npm
- **Database**: PostgreSQL (local or Docker Compose)
- **Environment**:
  - `NODE_ENV=development` (default)
  - `DATABASE_URL` (required)
  - `SESSION_SECRET` (required)
  - `PORT` (default: 3000)

### Docker Development

- **docker-compose.yml** defines Express app and PostgreSQL services
- **Automatic Database Creation**: PostgreSQL starts fresh each time
- **Volume Mounts**: Hot reload support for development

### Production Deployment

- **Docker Image**: `Dockerfile` creates lightweight production image
- **Runtime Environment**: Node.js ≥20 (TypeScript compiled to JavaScript in `dist/`)
- **Database Migrations**: Run automatically on server startup (no manual schema setup)
- **Environment Variables**: All required variables injected at runtime

### Render.com Deployment

- **Blueprint Configuration**: `render.yaml` enables one-click deployment
- **Automated Setup**: Render creates PostgreSQL database and deploys app
- **Environment Variables**: `DATABASE_URL` and `SESSION_SECRET` set automatically
- **SSL/TLS**: Enforced by Render proxy; set `secure: true` cookies automatically

### Environment Variables Required for Production

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@host:5432/app` |
| `SESSION_SECRET` | Secret key for signing sessions | Result of `openssl rand -hex 32` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | HTTP server port | `3000` |
| `DATABASE_SSL` | Enable SSL for database | `true` for Neon/Supabase |

## Error Handling

- **Database Connection Errors**: Server refuses to start; errors logged to stderr
- **Request Errors**: Caught by global error handler; returns `500 Something went wrong` with error logged
- **Validation Errors**: Caught by route handlers; specific error message returned with 4xx status
- **Session Errors**: Caught and propagated; trigger global error handler

## Performance Considerations

- **Connection Pooling**: `pg.Pool` reuses database connections
- **Session Pruning**: Automatic cleanup every 15 minutes prevents unbounded table growth
- **Bcryptjs Cost Factor**: 12 balances security and performance (takes ~100ms per hash)
- **No N+1 Queries**: Login/logout use direct queries, home page uses single user query
- **Stateless Routes**: `/health` requires no database access for fast monitoring

## Future Enhancements

Possible extensions without scope creep:
- OAuth/SAML provider integration
- Two-factor authentication (2FA)
- Email verification on registration
- Password reset via email
- Account recovery options
- Audit logging for security events
