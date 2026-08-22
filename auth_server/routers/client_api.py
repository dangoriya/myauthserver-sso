from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import ClientApp
from auth_utils import decode_token

router = APIRouter(prefix="/api/v1/client", tags=["Client API"])

class TokenIntrospectSchema(BaseModel):
    token: str
    client_id: str
    client_secret: str

@router.post("/introspect")
def introspect_token(data: TokenIntrospectSchema, db: Session = Depends(get_db)):
    client = db.query(ClientApp).filter(ClientApp.client_id == data.client_id).first()
    if not client or client.client_secret != data.client_secret:
        raise HTTPException(status_code=401, detail="Invalid client credentials")
    
    payload = decode_token(data.token)
    if not payload:
        return {"active": False}
    
    return {
        "active": True,
        "sub": payload.get("sub"),
        "client_id": payload.get("client_id"),
        "exp": payload.get("exp")
    }
