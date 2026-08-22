from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import oidc, admin_api, client_api

app = FastAPI(
    title="Central Auth Server (SSO)",
    description="OAuth2 / OpenID Connect SSO Server with FastAPI & Redis",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(oidc.router)
app.include_router(admin_api.router)
app.include_router(client_api.router)

@app.on_event("startup")
def startup_event():
    Base.metadata.create_all(bind=engine)

@app.get("/")
def root():
    return {
        "service": "Central Auth Server (SSO)",
        "status": "running",
        "discovery": "/.well-known/openid-configuration"
    }
