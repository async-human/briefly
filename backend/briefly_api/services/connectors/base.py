from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from briefly_api.config import Settings
from briefly_api.services.articles import NormalizedContent


@dataclass
class ConnectorValidation:
    valid: bool
    message: str = ""
    suggested_name: str | None = None


class BaseConnector(ABC):
    source_type: str
    label: str
    detect_hint: str

    @abstractmethod
    def normalize_identifier(self, identifier: str) -> str:
        raise NotImplementedError

    @abstractmethod
    async def fetch(
        self,
        identifier: str,
        settings: Settings,
        *,
        limit: int = 8,
        source_name: str | None = None,
        meta: dict | None = None,
    ) -> list[NormalizedContent]:
        raise NotImplementedError

    def can_handle(self, identifier: str) -> bool:
        return False

    async def validate(self, identifier: str, settings: Settings) -> ConnectorValidation:
        normalized = self.normalize_identifier(identifier)
        if not normalized:
            return ConnectorValidation(valid=False, message="Identifier is empty.")
        return ConnectorValidation(valid=True)

    async def get_metadata(self, identifier: str, settings: Settings) -> dict:
        return {}
