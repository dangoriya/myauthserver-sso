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
    MANAGEMENT_URL: str = "http://localhost:3000"


    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
