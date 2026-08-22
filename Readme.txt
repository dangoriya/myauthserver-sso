================================================================================
          IAM AUTH & CENTRALIZED IDENTITY MANAGEMENT SERVER
================================================================================

1. OVERVIEW
--------------------------------------------------------------------------------
IAM Auth Server is an enterprise-grade, high-performance Identity and Access 
Management (IAM) platform built with FastAPI (Backend), Next.js 14 App Router 
(Management Portal), PostgreSQL (Database), Redis (Caching & Sessions), and Docker.

It provides centralized authentication (OAuth2 / OIDC), Role-Based Access Control 
(RBAC), Email Verification Signup, Two-Factor Authentication (2FA TOTP), and 
Google SSO integration.


2. KEY FEATURES & ARCHITECTURE
--------------------------------------------------------------------------------
• Custom Email Signup with Verification:
  - Users register via custom email by first receiving a 6-digit verification code.
  - Upon successful email verification, users complete password setup.
  - Default assigned role is 'normal-user'. Only administrators can change roles.

• Step-by-Step 2FA TOTP Setup:
  - Supports optional 2FA setup immediately following registration or inside Profile.
  - Displays QR Code + Manual setup information (Service Name, Secret Key).
  - Compatible with Google Authenticator, Authy, and 1Password.

• Secure 2FA Reset via Email OTP:
  - Logged-in users who lose their 2FA device can request an Email OTP to verify identity 
    and regenerate a fresh 2FA secret key in 'My Profile'.

• Dual Email Provider Engine (SMTP & Brevo API):
  - Configurable email delivery service supporting standard SMTP or Brevo REST API.
  - Development fallback logs verification codes cleanly to stdout if no email credentials are set.

• Dynamic Role-Based Access Control (RBAC):
  - Default master roles: 'admin' and 'normal-user'.
  - Auto-incrementing role ordering with real-time active user count tracking.
  - Deleting a role automatically disables all associated users with clear warning alerts.

• Instant Auth Guard Redirection:
  - Next.js portal implements zero-flash route protection for all sensitive pages.


3. ENVIRONMENT CONFIGURATION (.env & docker-compose.yml)
--------------------------------------------------------------------------------
Configure the environment variables in docker-compose.yml or .env:

# Database & Redis Configuration
DATABASE_URL=postgresql://postgres:postgres@postgresdb:5432/auth_db
REDIS_URL=redis://redis:6379/0

# App URLs
AUTH_SERVER_URL=http://localhost:8000
MANAGEMENT_URL=http://localhost:3005

# Email Service Provider Configuration ("smtp" or "brevo_api")
EMAIL_PROVIDER=smtp              # Options: "smtp" or "brevo_api"

# SMTP Options (When EMAIL_PROVIDER=smtp)
SMTP_HOST=smtp.brevo.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASSWORD=your_smtp_password
SMTP_USE_TLS=true

# Brevo REST API Options (When EMAIL_PROVIDER=brevo_api)
BREVO_API_KEY=xkeysib-your_brevo_api_key_here

# Sender Details
EMAIL_FROM=no-reply@yourdomain.com
EMAIL_FROM_NAME=IAM Security Team

# Database Reset on Startup (Optional for Testing)
RESET_DB=false                   # Set true to reset schema on container restart


4. DEFAULT ADMINISTRATOR CREDENTIALS
--------------------------------------------------------------------------------
Upon initial startup or migration seeding, the system creates default admin credentials:

  URL:      http://localhost:3005
  Email:    admin@example.com
  Password: admin123


5. HOW TO RUN & DEPLOY
--------------------------------------------------------------------------------
A. Run via Docker Compose (Recommended):
   $ docker-compose up --build

B. Run Database Migrations Manually:
   $ cd auth_server
   $ python scripts/migrate_db.py           # Standard migration & seed
   $ python scripts/migrate_db.py --reset   # Drop & re-create fresh tables


6. REST API ENDPOINTS & SWAGGER DOCUMENTATION
--------------------------------------------------------------------------------
Interactive API Documentation (Swagger / OpenAPI) is available at:
http://localhost:8000/docs

Key API Endpoints Summary:
• Authentication & Signup:
  - POST /api/v1/auth/login                  # IAM Login (Password + 2FA check)
  - POST /api/v1/auth/login/2fa-verify       # Verify 2FA TOTP code on login
  - POST /api/v1/auth/signup/request-code    # Request 6-digit email signup code
  - POST /api/v1/auth/signup/verify-code     # Verify email signup code
  - POST /api/v1/auth/signup/complete        # Complete registration & get 2FA setup details
  - POST /api/v1/auth/signup/2fa-enable      # Activate 2FA TOTP for new user

• User Profile & Security:
  - GET  /api/v1/user/profile                # Fetch current user profile
  - POST /api/v1/user/change-password        # Change password
  - POST /api/v1/user/2fa/setup-qr           # Generate 2FA QR Code & Secret
  - POST /api/v1/user/2fa/verify-and-enable   # Enable 2FA with 6-digit TOTP code
  - POST /api/v1/user/2fa/disable            # Disable 2FA
  - POST /api/v1/user/2fa/reset-request-otp  # Request email OTP to reset 2FA
  - POST /api/v1/user/2fa/reset-confirm-otp  # Confirm email OTP & reset 2FA secret key

• Admin Management APIs:
  - GET  /api/v1/admin/users                 # List & filter users (search, role, status)
  - POST /api/v1/admin/users                 # Create new user
  - PUT  /api/v1/admin/users/{user_id}       # Update user (name, picture, role, 2FA, active status)
  - GET  /api/v1/admin/roles                 # List system roles with active user counts
  - POST /api/v1/admin/roles                 # Create role (auto-increment order)
  - DELETE /api/v1/admin/roles/{role_id}     # Delete role (auto-disables associated users)
  - GET/POST /api/v1/admin/google-settings   # Configure Google SSO & Global 2FA policy


================================================================================
                    IAM AUTH SERVER — DEVELOPER DOCUMENTATION
================================================================================
