import os
from pydantic_settings import BaseSettings
from pydantic import model_validator

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
    REDIS_PASSWORD: str = ""
    REDIS_URL: str = ""

    @model_validator(mode="after")
    def build_redis_url(self):
        if not self.REDIS_URL:
            if self.REDIS_PASSWORD:
                from urllib.parse import quote_plus
                encoded_password = quote_plus(self.REDIS_PASSWORD)
                self.REDIS_URL = f"redis://:{encoded_password}@{self.REDIS_HOST}:{self.REDIS_PORT}/0"
            else:
                self.REDIS_URL = f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/0"
        return self
    
    @model_validator(mode="after")
    def set_management_fallbacks(self):
        if not self.CENTRAL_DASHBOARD_URL:
            self.CENTRAL_DASHBOARD_URL = self.MANAGEMENT_URL
        if not self.LOGOUT_REDIRECT_URL:
            self.LOGOUT_REDIRECT_URL = self.MANAGEMENT_URL
        return self
    
    AUTH_SERVER_URL: str = "http://localhost:8000"
    MANAGEMENT_URL: str = "http://localhost:3005"
    CENTRAL_DASHBOARD_URL: str = ""
    LOGOUT_REDIRECT_URL: str = ""

    BACKCHANNEL_LOGOUT_ENABLED: bool = False

    # Email Service Settings (SMTP or Brevo API)
    EMAIL_PROVIDER: str = "smtp"  # "smtp" or "brevo_api"
    SMTP_HOST: str = "smtp-relay.brevo.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False  # Implicit TLS (port 465)

    BREVO_API_KEY: str = ""
    EMAIL_FROM: str = "no-reply@myauth.local"
    EMAIL_FROM_NAME: str = "IAM Security Team"


    class Config:
        env_file = None  # Rely solely on environment variables from docker-compose
        extra = "allow"

settings = Settings()
