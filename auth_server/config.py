import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ENV: str = "development"
    SECRET_KEY: str = "super-secret-jwt-signing-key-change-in-production-123456789"
    JWT_ALGORITHM: str = "RS256"
    
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "auth_db"
    POSTGRES_HOST: str = "postgresdb"
    POSTGRES_PORT: int = 5432
    DATABASE_URL: str = "postgresql://postgres:postgres@postgresdb:5432/auth_db"
    
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    REDIS_URL: str = "redis://redis:6379/0"
    
    AUTH_SERVER_URL: str = "http://localhost:8000"
    MANAGEMENT_URL: str = "http://localhost:3005"
    CENTRAL_DASHBOARD_URL: str = "http://localhost:3005"
    SUCCESSFUL_SIGNUP_REDIRECT_URL: str = "http://localhost:3005"
    LOGOUT_REDIRECT_URL: str = "http://localhost:3005"
    # Base URL the OP rewrites to when calling loopback client URIs for
    # OIDC Back-Channel Logout. Set to e.g. http://host.docker.internal
    # in containerised setups so the OP can reach apps on the Docker host.
    CLIENT_CALLBACK_BASE_URL: str = ""

    # Email Service Settings (SMTP or Brevo API)
    EMAIL_PROVIDER: str = "smtp"  # "smtp" or "brevo_api"
    SMTP_HOST: str = "smtp.brevo.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True

    BREVO_API_KEY: str = ""
    EMAIL_FROM: str = "no-reply@myauth.local"
    EMAIL_FROM_NAME: str = "IAM Security Team"


    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
