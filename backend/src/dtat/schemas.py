"""Shared Pydantic building blocks."""

from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict


def _blank_to_none(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


# Optional text: surrounding whitespace is dropped, an empty string means "no value".
OptStr = Annotated[str | None, BeforeValidator(_blank_to_none)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str
