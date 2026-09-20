from dataclasses import dataclass


@dataclass(slots=True)
class ServiceError(Exception):
    status_code: int
    code: str
    message: str
