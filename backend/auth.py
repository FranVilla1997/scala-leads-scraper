"""JWT validation against Supabase + role-aware FastAPI dependencies.

Supports both the new ECC (ES256/RS256) signing keys via JWKS *and* the legacy
HS256 shared secret as fallback.
"""
from __future__ import annotations

import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Header, Query
from pydantic import BaseModel

from config import SUPABASE_JWT_SECRET, SUPABASE_URL
from db import get_user_profile, get_seller_zones


class CurrentUser(BaseModel):
    id: str
    email: str
    role: str
    zones: list[str] = []

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


# Lazy-init JWKS client for asymmetric tokens (ES256/RS256). PyJWKClient caches
# fetched keys; we just reuse the same instance.
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    global _jwks_client
    if _jwks_client is None and SUPABASE_URL:
        _jwks_client = PyJWKClient(f"{SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def _decode_token(token: str) -> dict:
    # Peek at the header to choose the right verification path
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {e}")

    alg = header.get("alg", "")

    # Asymmetric (current Supabase default): verify with JWKS
    if alg in ("ES256", "RS256", "EdDSA"):
        client = _get_jwks_client()
        if not client:
            raise HTTPException(status_code=500, detail="SUPABASE_URL no configurado para JWKS")
        try:
            signing_key = client.get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                leeway=60,
            )
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expirado")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Token inválido: {e}")
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Error validando token: {e}")

    # Legacy symmetric secret
    if alg == "HS256":
        if not SUPABASE_JWT_SECRET:
            raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET no configurado")
        try:
            return jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
                leeway=60,
            )
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Token expirado")
        except jwt.InvalidTokenError as e:
            raise HTTPException(status_code=401, detail=f"Token inválido: {e}")

    raise HTTPException(status_code=401, detail=f"Token inválido: algoritmo {alg!r} no soportado")


def _extract_token(authorization: str | None, access_token: str | None) -> str:
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
