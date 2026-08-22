from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    hashed_password = Column(String, nullable=True) # Null for OAuth-only users
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    provider = Column(String, default="local") # "local" or "google"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ClientApp(Base):
    __tablename__ = "client_apps"

    id = Column(String, primary_key=True, default=generate_uuid)
    client_id = Column(String, unique=True, index=True, nullable=False)
    client_secret = Column(String, nullable=False)
    client_name = Column(String, nullable=False)
    redirect_uris = Column(Text, nullable=False) # Space or comma separated URIs
    allowed_grant_types = Column(String, default="authorization_code")
    is_sso_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class GoogleSetting(Base):
    __tablename__ = "google_settings"

    id = Column(Integer, primary_key=True, default=1)
    client_id = Column(String, nullable=True)
    client_secret = Column(String, nullable=True)
    redirect_uri = Column(String, nullable=True)
    is_enabled = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
