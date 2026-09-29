"""Test fixtures.

Tests run against a real PostgreSQL with PostGIS: set TEST_DATABASE_URL to use an existing
server (CI does this), otherwise a throwaway container is started with testcontainers.
Every test runs inside a transaction that is rolled back afterwards.
"""

import os
from collections.abc import Iterator
from pathlib import Path

os.environ.setdefault("DTAT_COOKIE_SECURE", "false")
os.environ.setdefault("DTAT_SECRET_KEY", "test-secret-key-0123456789-0123456789")

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Connection, Engine, create_engine
from sqlalchemy.orm import Session

from dtat.auth.models import Role
from dtat.auth.schemas import UserCreate
from dtat.auth.service import create_user
from dtat.db import get_session
from dtat.main import create_app

DB_IMAGE = "timescale/timescaledb-ha:pg16"
BACKEND_DIR = Path(__file__).resolve().parent.parent
PASSWORD = "password-123"


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer(DB_IMAGE, driver="psycopg") as container:
        yield container.get_connection_url()


@pytest.fixture(scope="session")
def engine(database_url: str) -> Iterator[Engine]:
    engine = create_engine(database_url)
    config = Config(BACKEND_DIR / "alembic.ini")
    config.attributes["configure_logger"] = False
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
        command.upgrade(config, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def connection(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as connection:
        transaction = connection.begin()
        yield connection
        transaction.rollback()


def _session(connection: Connection) -> Session:
    # Commits become savepoint releases; the outer transaction is rolled back after the test.
    return Session(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )


@pytest.fixture
def session(connection: Connection) -> Iterator[Session]:
    with _session(connection) as session:
        yield session


@pytest.fixture
def app_client(connection: Connection) -> Iterator[TestClient]:
    def request_session() -> Iterator[Session]:
        # A fresh session per request, like in production: uncommitted changes are discarded.
        with _session(connection) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = request_session
    with TestClient(app) as client:
        yield client


def _login(client: TestClient, session: Session, username: str, role: Role) -> TestClient:
    create_user(session, UserCreate(username=username, password=PASSWORD, role=role))
    session.commit()
    response = client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return client


@pytest.fixture
def admin(app_client: TestClient, session: Session) -> TestClient:
    return _login(app_client, session, "admin", Role.ADMIN)


@pytest.fixture
def engineer(app_client: TestClient, session: Session) -> TestClient:
    return _login(app_client, session, "engineer", Role.ENGINEER)


@pytest.fixture
def viewer(app_client: TestClient, session: Session) -> TestClient:
    return _login(app_client, session, "viewer", Role.VIEWER)
