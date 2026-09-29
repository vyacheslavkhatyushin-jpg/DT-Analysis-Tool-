from enum import StrEnum


class ChangeSource(StrEnum):
    UI = "ui"
    IMPORT = "import"
    API = "api"
    SYSTEM = "system"


class ChangeAction(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
