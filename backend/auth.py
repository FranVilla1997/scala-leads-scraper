"""JWT validation against Supabase + role-aware FastAPI dependencies."""
from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, Header, Query, status
from pydantic import BaseModel

from config import SUPABASE_JWT_SECRET
from db import get_user_profile, get_seller_zones


class CurrentUser(BaseModel):
    id: str
    email: str
    role: str
    zones: list[str] = []

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def _decode_token(token: str) -> dict:
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET no configurado")
    try:
        return jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {e}")


def _extract_token(authorization: str | None, access_token: str | None) -> str:
    # Header tiene prioridad; query param se usa para SSE (EventSource no soporta headers)
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    if access_token:
        return access_token
    raise HTTPException(status_code=401, detail="Falta token de autenticación")


async def require_user(
    authorization: str | None = Header(default=None),
    access_token: str | None = Query(default=None),
) -> CurrentUser:
    token = _extract_token(authorization, access_token)
    payload = _decode_token(token)

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token sin sub")

    profile = get_user_profile(user_id)
    if not profile:
        raise HTTPException(status_code=403, detail="Usuario sin perfil. Contactar al admin.")
    if not profile.get("active", True):
        raise HTTPException(status_code=403, detail="Usuario inactivo")

    zones = get_seller_zones(user_id) if profile["role"] == "vendedor" else []
    return CurrentUser(
        id=user_id,
        email=profile["email"],
        role=profile["role"],
        zones=zones,
    )


async def require_admin(user: CurrentUser = Depends(require_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Requiere rol admin")
    return user
