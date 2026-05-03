from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any


@dataclass
class EmailProviderPreset:
    key: str
    display_name: str
    domains: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    imap: dict[str, Any] | None = None
    smtp: dict[str, Any] | None = None
    auth: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def matches_domain(self, domain: str) -> bool:
        normalized = domain.lower().strip()
        return normalized in {item.lower().strip() for item in self.domains}

    def matches_alias(self, alias: str) -> bool:
        normalized = alias.lower().strip()
        return normalized in {item.lower().strip() for item in self.aliases}

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "displayName": self.display_name,
            "domains": self.domains,
            "aliases": self.aliases,
            "imap": self.imap,
            "smtp": self.smtp,
            "auth": self.auth,
        }


class EmailProviderPresetStore:
    def __init__(self, preset_file: str | Path | None = None) -> None:
        self.preset_file = Path(
            preset_file or Path(__file__).with_name("provider_presets.json")
        )
        self._cache: dict[str, EmailProviderPreset] | None = None

    def load(self) -> dict[str, EmailProviderPreset]:
        if self._cache is not None:
            return self._cache

        if not self.preset_file.exists():
            self._cache = {}
            return self._cache

        raw = json.loads(self.preset_file.read_text(encoding="utf-8"))
        presets: dict[str, EmailProviderPreset] = {}
        for key, value in raw.items():
            if not isinstance(value, dict):
                continue
            preset_key = self.normalize_key(key)
            presets[preset_key] = EmailProviderPreset(
                key=preset_key,
                display_name=str(value.get("displayName") or key).strip() or preset_key,
                domains=[
                    str(item).strip().lower()
                    for item in value.get("domains") or []
                    if str(item).strip()
                ],
                aliases=[
                    str(item).strip()
                    for item in value.get("aliases") or []
                    if str(item).strip()
                ],
                imap=value.get("imap") if isinstance(value.get("imap"), dict) else None,
                smtp=value.get("smtp") if isinstance(value.get("smtp"), dict) else None,
                auth=value.get("auth") if isinstance(value.get("auth"), dict) else None,
                raw=value,
            )
        self._cache = presets
        return presets

    def get(self, key: str) -> EmailProviderPreset | None:
        return self.load().get(self.normalize_key(key))

    def match_by_domain(self, domain: str) -> EmailProviderPreset | None:
        normalized = domain.lower().strip()
        for preset in self.load().values():
            if preset.matches_domain(normalized):
                return preset
        return None

    def match_by_alias(self, alias: str) -> EmailProviderPreset | None:
        normalized = alias.lower().strip()
        for preset in self.load().values():
            if preset.matches_alias(normalized):
                return preset
        return None

    @staticmethod
    def normalize_key(value: str) -> str:
        return str(value or "").strip().lower()
