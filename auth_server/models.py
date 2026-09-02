from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, unique=True, nullable=False)
    label = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True) # Null for OAuth-only users
    role = Column(String, default="normal-user", nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    provider = Column(String, default="local") # "local" or "google"
    is_2fa_enabled = Column(Boolean, default=False)
    totp_secret = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    role_rel = relationship("Role", foreign_keys=[role_id])

class ClientApp(Base):
    __tablename__ = "client_apps"

    id = Column(String, primary_key=True, default=generate_uuid)
    client_id = Column(String, unique=True, index=True, nullable=False)
    client_secret = Column(String, nullable=False)
    client_name = Column(String, nullable=False)
    redirect_uris = Column(Text, nullable=False) # Space or comma separated URIs
    allowed_grant_types = Column(String, default="authorization_code")
    is_sso_enabled = Column(Boolean, default=True)

    # ----- OIDC Logout 1.0 configuration -----
    # Comma-separated list of URIs the user can be redirected back to after
    # RP-Initiated Logout. Must match the registered origin(s) for this client.
    post_logout_redirect_uris = Column(Text, nullable=True)
    # Comma-separated list of absolute URIs the OP calls (HTTP POST) to
    # notify the client of a back-channel logout event.
    backchannel_logout_uris = Column(Text, nullable=True)
    # OIDC Back-Channel Logout 1.0 — when True, the OP will send a
    # logout_token to all backchannel_logout_uris of clients whose user
    # had an active session on this client. Required for true SLO.
    backchannel_logout_enabled = Column(Boolean, default=False)

    created_at = Column(DateTime, default=datetime.utcnow)

class GoogleSetting(Base):
    __tablename__ = "google_settings"

    id = Column(Integer, primary_key=True, default=1)
    client_id = Column(String, nullable=True)
    client_secret = Column(String, nullable=True)
    redirect_uri = Column(String, nullable=True)
    is_enabled = Column(Boolean, default=False)
    enforce_2fa_all = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
