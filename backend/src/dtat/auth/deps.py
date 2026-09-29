from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from dtat.audit.service import Actor, ChangeSource
from dtat.auth.models import Role, User
from dtat.auth.security import COOKIE_NAME, decode_access_token
from dtat.db import get_session

DbSession = Annotated[Session, Depends(get_session)]


def _token_from_request(request: Request) -> str | None:
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(COOKIE_NAME)


def get_current_user(request: Request, session: DbSession) -> User:
    token = _token_from_request(request)
    user_id = decode_access_token(token) if token else None
    user = session.get(User, user_id) if user_id is not None else None
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход в систему")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: Role) -> Callable[[User], User]:
    def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав")
        return user

    return dependency


EditorUser = Annotated[User, Depends(require_role(Role.ADMIN, Role.ENGINEER))]
AdminUser = Annotated[User, Depends(require_role(Role.ADMIN))]


def ui_actor(user: User) -> Actor:
    return Actor(user_id=user.id, username=user.username, source=ChangeSource.UI)
