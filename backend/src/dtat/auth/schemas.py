from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from dtat.auth.models import Role
from dtat.schemas import OptStr, ORMModel

Username = Annotated[str, Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")]
Password = Annotated[str, Field(min_length=8, max_length=128)]


class LoginRequest(BaseModel):
    username: str
    password: str


class UserRead(ORMModel):
    id: int
    username: str
    full_name: str | None
    role: Role
    is_active: bool
    last_login_at: datetime | None


class LoginResponse(BaseModel):
    user: UserRead
    # Also returned for scripts and tools; the browser relies on the httpOnly cookie.
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: Username
    full_name: OptStr = Field(default=None, max_length=128)
    role: Role = Role.VIEWER
    password: Password


class UserUpdate(BaseModel):
    full_name: OptStr = Field(default=None, max_length=128)
    role: Role | None = None
    is_active: bool | None = None
    password: Password | None = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: Password
