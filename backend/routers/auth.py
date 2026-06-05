import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
from models import AuditLog, User
from schemas import LoginRequest, Token, UserOut

SECRET_KEY = os.environ.get("JWT_SECRET", "osiris-bluebird-dev-secret-change-in-production-2026")
ALGORITHM = "HS256"
TOKEN_HOURS = 8

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

router = APIRouter(prefix="/auth", tags=["auth"])


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(username: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_HOURS)
    return jwt.encode({"sub": username, "role": role, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired or invalid. Please log in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc
    user = db.query(User).filter(User.username == username, User.is_active == True).first()
    if not user:
        raise exc
    return user


def seed_default_users(db: Session) -> None:
    defaults = [
        ("admin",  "Admin User",   "admin",  "Osiris2026!"),
        ("jean",   "Jean",         "coach",  "Bluebird2026!"),
        ("hannah", "Hannah",       "coach",  "Bluebird2026!"),
        ("ross",   "Ross",         "coach",  "Bluebird2026!"),
        ("larry",  "Larry",        "coach",  "Bluebird2026!"),
        ("amelia", "Amelia",       "coach",  "Bluebird2026!"),
    ]
    for username, full_name, role, password in defaults:
        exists = db.query(User).filter(User.username == username).first()
        if not exists:
            db.add(User(
                username=username,
                full_name=full_name,
                role=role,
                hashed_password=get_password_hash(password),
            ))
    db.commit()


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username, User.is_active == True).first()
    ip = request.client.host if request.client else None

    if not user or not verify_password(payload.password, user.hashed_password):
        db.add(AuditLog(username=payload.username, action="LOGIN_FAILED",
                        detail="Invalid credentials", ip_address=ip))
        db.commit()
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token = create_access_token(user.username, user.role)
    user.last_login = datetime.utcnow()
    db.add(AuditLog(username=user.username, action="LOGIN",
                    detail="Successful login", ip_address=ip))
    db.commit()
    db.refresh(user)
    return Token(access_token=token, token_type="bearer", user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return UserOut.model_validate(current_user)


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.add(AuditLog(username=current_user.username, action="LOGOUT", detail="User logged out"))
    db.commit()
    return {"message": "Logged out"}
