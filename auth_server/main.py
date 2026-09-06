from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from database import engine, Base
from routers import oidc, admin_api, client_api
from routers import auth_pages
from config import settings
from security import ensure_keys_on_startup
import logging

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Central Auth Server (SSO)",
    description="OAuth2 / OpenID Connect SSO Server with FastAPI, Jinja2 templates & Redis",
    version="2.0.0"
)

# ---------------------------------------------------------------------------
# Jinja2 templates & static files
# ---------------------------------------------------------------------------
templates = Jinja2Templates(directory="templates")
app.state.templates = templates

# Static assets (CSS, JS, images)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ---------------------------------------------------------------------------
# CORS — not required for current architecture.
# The management app (Next.js BFF proxy) and test_client_app1 both make
# server-to-server calls to this auth_server using INTERNAL_AUTH_SERVER_URL.
# Browsers only interact via OIDC redirects (GET navigation), which don't
# trigger CORS. If direct browser-to-OP AJAX calls are added later,
# configure CORS_ALLOWED_ORIGINS here.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(oidc.router)
app.include_router(admin_api.router)
app.include_router(client_api.router)
app.include_router(auth_pages.router)


@app.on_event("startup")
def startup_event():
    # 1. Create database tables
    Base.metadata.create_all(bind=engine)

    # 2. Ensure the OIDC RSA keypair exists and is persisted to disk
    #    (so RS256 tokens issued by this server are valid across
    #    container restarts). If the key directory isn't writable the
    #    keypair is kept in memory and we log a clear warning.
    try:
        priv, pub = ensure_keys_on_startup()
        logger.info(
            "OIDC RSA keypair ready (private=%d bytes, public=%d bytes)",
            len(priv), len(pub),
        )
    except Exception as e:
        logger.exception("Failed to initialise OIDC RSA keypair: %s", e)
        # Don't re-raise — the app can still serve requests with an
        # in-memory keypair; we'll just lose tokens on restart. The
        # operator should fix the IAM_KEY_DIR permissions.


@app.get("/")
def root():
    return {
        "service": "Central Auth Server (SSO)",
        "version": "2.0.0",
        "status": "running",
        "discovery": "/.well-known/openid-configuration",
        "login_page": "/authorize",
        "signup_page": "/signup",
    }


# Healthcheck used by Docker / load balancers
@app.get("/healthz")
def healthz():
    return {"status": "ok"}
