"""Domain errors raised by services and mapped to HTTP responses in main.py.

Messages are user-facing (Russian UI), so they are written in Russian.
"""


class DomainError(Exception):
    status_code = 400

    def __init__(self, message: str, *, field: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.field = field


class NotFoundError(DomainError):
    status_code = 404


class ConflictError(DomainError):
    status_code = 409


class InvalidDataError(DomainError):
    status_code = 422
