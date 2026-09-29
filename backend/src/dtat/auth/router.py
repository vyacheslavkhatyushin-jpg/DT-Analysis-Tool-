from fastapi import APIRouter, HTTPException, Response, status

from dtat.auth import service
from dtat.auth.deps import AdminUser, CurrentUser, DbSession
from dtat.auth.schemas import (
    LoginRequest,
    LoginResponse,
    PasswordChange,
    UserCreate,
    UserRead,
    UserUpdate,
)
from dtat.auth.security import COOKIE_NAME, create_access_token
from dtat.config import get_settings

router = APIRouter(tags=["auth"])


@router.post("/auth/login")
def login(body: LoginRequest, response: Response, session: DbSession) -> LoginResponse:
    user = service.authenticate(session, body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверное имя пользователя или пароль")
    session.commit()
    settings = get_settings()
    token = create_access_token(user.id)
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.access_token_ttl_minutes * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return LoginResponse(user=UserRead.model_validate(user), access_token=token)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/auth/me")
def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.post("/auth/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: CurrentUser, session: DbSession) -> None:
    service.change_password(session, user, body.current_password, body.new_password)
    session.commit()


@router.get("/users")
def list_users(_: AdminUser, session: DbSession) -> list[UserRead]:
    return [UserRead.model_validate(u) for u in service.list_users(session)]


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, _: AdminUser, session: DbSession) -> UserRead:
    user = service.create_user(session, body)
    session.commit()
    return UserRead.model_validate(user)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, _: AdminUser, session: DbSession) -> UserRead:
    user = service.update_user(session, user_id, body)
    session.commit()
    return UserRead.model_validate(user)
