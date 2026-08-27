FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistent RSA key directory for OIDC token signing
# In Docker, the /app/keys path is mounted as a volume (see docker-compose.yml)
# so the keypair survives container restarts.
RUN mkdir -p /app/keys
ENV IAM_KEY_DIR=/app/keys

EXPOSE 8000

# Container Startup Command
# To auto-migrate and seed roles & admin user on startup:
CMD ["sh", "-c", "python scripts/migrate_db.py && uvicorn main:app --host 0.0.0.0 --port 8000"]

# --- PRODUCTION / LIVE ENVIRONMENT OPTIONS ---
# For production (if you prefer running migrations manually or externally), comment out the CMD above and uncomment:
# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# --- FRESH / TESTING ENVIRONMENT OPTIONS ---
# To force reset/drop database tables on startup during development/testing, set environment variable RESET_DB=true in docker-compose.yml or run:
# CMD ["sh", "-c", "python scripts/init_admin.py --reset && uvicorn main:app --host 0.0.0.0 --port 8000"]
