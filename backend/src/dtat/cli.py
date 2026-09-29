"""Command-line tools: `dtat --help`."""

import json
from pathlib import Path
from typing import Annotated

import typer

from dtat.auth import service as auth_service
from dtat.auth.models import Role
from dtat.auth.schemas import UserCreate
from dtat.config import get_settings
from dtat.db import get_sessionmaker
from dtat.errors import DomainError

app = typer.Typer(no_args_is_help=True, help="DT Analysis Tool: служебные команды")


@app.command()
def bootstrap() -> None:
    """Create the initial admin from DTAT_INITIAL_ADMIN_* variables if there are no users yet."""
    settings = get_settings()
    with get_sessionmaker()() as session:
        if auth_service.count_users(session):
            typer.echo("Пользователи уже есть, пропускаю")
            return
        if not settings.initial_admin_password:
            typer.echo(
                "DTAT_INITIAL_ADMIN_PASSWORD не задан: создайте администратора `dtat create-user`"
            )
            return
        auth_service.create_user(
            session,
            UserCreate(
                username=settings.initial_admin_username,
                password=settings.initial_admin_password,
                role=Role.ADMIN,
            ),
        )
        session.commit()
        typer.echo(f"Создан администратор {settings.initial_admin_username}")


@app.command("create-user")
def create_user(
    username: str,
    role: Annotated[Role, typer.Option()] = Role.ADMIN,
    full_name: Annotated[str | None, typer.Option()] = None,
    password: Annotated[
        str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)
    ] = "",
) -> None:
    """Create a user (asks for the password)."""
    with get_sessionmaker()() as session:
        try:
            auth_service.create_user(
                session,
                UserCreate(username=username, full_name=full_name, role=role, password=password),
            )
        except DomainError as exc:
            typer.echo(exc.message, err=True)
            raise typer.Exit(1) from exc
        session.commit()
    typer.echo(f"Пользователь {username} ({role.value}) создан")


@app.command("seed-demo")
def seed_demo(
    seed: int = 42,
    lat: Annotated[float, typer.Option(help="Широта центра карьера")] = 54.05,
    lon: Annotated[float, typer.Option(help="Долгота центра карьера")] = 87.25,
) -> None:
    """Fill an empty inventory with a synthetic quarry network."""
    from dtat.synthetic.quarry import QuarryParams, seed_quarry

    with get_sessionmaker()() as session:
        try:
            summary = seed_quarry(session, QuarryParams(center_lat=lat, center_lon=lon, seed=seed))
        except RuntimeError as exc:
            typer.echo(str(exc), err=True)
            raise typer.Exit(1) from exc
        session.commit()
    typer.echo(
        f"Демо-карьер: сайтов {summary.sites}, сот {summary.cells}, техники {summary.assets}, "
        f"устройств {summary.devices}, слоёв карты {summary.overlays}"
    )
    for note in summary.notes:
        typer.echo(f"  {note}")


@app.command()
def openapi(output: Annotated[Path | None, typer.Argument()] = None) -> None:
    """Print or save the OpenAPI schema (used to generate frontend types)."""
    from dtat.main import create_app

    schema = json.dumps(create_app().openapi(), ensure_ascii=False, indent=2) + "\n"
    if output is None:
        typer.echo(schema, nl=False)
    else:
        output.write_text(schema, encoding="utf-8")


if __name__ == "__main__":
    app()
