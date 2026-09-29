from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from dtat.auth.models import Role, User
from dtat.auth.schemas import UserCreate, UserUpdate
from dtat.auth.security import hash_password, verify_password
from dtat.db import utcnow
from dtat.errors import ConflictError, InvalidDataError, NotFoundError


def authenticate(session: Session, username: str, password: str) -> User | None:
    user = session.scalars(select(User).where(User.username == username)).one_or_none()
    if not verify_password(password, user.password_hash if user else None):
        return None
    if user is None or not user.is_active:
        return None
    user.last_login_at = utcnow()
    return user


def list_users(session: Session) -> Sequence[User]:
    return session.scalars(select(User).order_by(User.username)).all()


def count_users(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(User)) or 0


def create_user(session: Session, data: UserCreate) -> User:
    if session.scalars(select(User.id).where(User.username == data.username)).first() is not None:
        raise ConflictError(f"Пользователь {data.username} уже существует", field="username")
    user = User(
        username=data.username,
        full_name=data.full_name,
        role=data.role,
        password_hash=hash_password(data.password),
    )
    session.add(user)
    session.flush()
    return user


def _active_admins(session: Session) -> int:
    query = select(func.count()).select_from(User).where(User.role == Role.ADMIN, User.is_active)
    return session.scalar(query) or 0


def update_user(session: Session, user_id: int, data: UserUpdate) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise NotFoundError(f"Пользователь #{user_id} не найден")
    values = data.model_dump(exclude_unset=True)
    if values.get("role") is None:
        values.pop("role", None)
    if values.get("is_active") is None:
        values.pop("is_active", None)
    loses_admin = (
        user.role == Role.ADMIN
        and user.is_active
        and (values.get("role", Role.ADMIN) != Role.ADMIN or values.get("is_active") is False)
    )
    if loses_admin and _active_admins(session) <= 1:
        raise InvalidDataError("Нельзя отключить или понизить последнего администратора")
    password = values.pop("password", None)
    for field, value in values.items():
        setattr(user, field, value)
    if password:
        user.password_hash = hash_password(password)
    session.flush()
    return user


def change_password(session: Session, user: User, current: str, new: str) -> None:
    if not verify_password(current, user.password_hash):
        raise InvalidDataError("Текущий пароль указан неверно", field="current_password")
    user.password_hash = hash_password(new)
    session.flush()
