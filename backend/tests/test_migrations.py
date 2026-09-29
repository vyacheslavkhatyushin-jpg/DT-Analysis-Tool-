from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine

from dtat.db import include_object
from dtat.models import Base


def test_migrations_match_models(engine: Engine) -> None:
    """The schema built by the migrations is what the ORM models describe."""
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection, opts={"include_object": include_object, "compare_type": True}
        )
        assert compare_metadata(context, Base.metadata) == []
