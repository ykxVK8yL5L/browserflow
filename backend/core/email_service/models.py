from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class EmailProviderType(str, Enum):
    IMAP = "imap"
    INBOXES = "inboxes"
    GENERATOR_EMAIL = "generator.email"


@dataclass
class EmailAddressInfo:
    raw: str
    normalized: str
    local_part: str
    domain: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EmailAccountRecord:
    credential_id: str
    name: str
    site: str
    provider: str
    identifier: str | None = None
    account_tag: str = ""
    address: str | None = None
    aliases: list[str] = field(default_factory=list)
    username: str | None = None
    auth_type: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    secrets: dict[str, Any] = field(default_factory=dict, repr=False)

    def matches_address(self, normalized_address: str) -> bool:
        normalized_address = normalized_address.lower().strip()
        if self.address and self.address.lower().strip() == normalized_address:
            return True
        return normalized_address in {alias.lower().strip() for alias in self.aliases}

    def to_dict(self) -> dict[str, Any]:
        return {
            "credentialId": self.credential_id,
            "name": self.name,
            "site": self.site,
            "provider": self.provider,
            "identifier": self.identifier,
            "accountTag": self.account_tag,
            "address": self.address,
            "aliases": self.aliases,
            "username": self.username,
            "authType": self.auth_type,
            "metadata": self.metadata,
        }


@dataclass
class EmailProviderRequest:
    user_id: str
    provider: str
    action: str
    account_tag: str = ""
    address_type: str | None = None
    alias_label: str = ""
    email_address: str | None = None
    folder: str = "INBOX"
    from_filter: str = ""
    subject_filter: str = ""
    contains_filter: str = ""
    time_config: dict[str, Any] = field(default_factory=dict)
    wait_config: dict[str, Any] = field(default_factory=dict)
    extraction_config: dict[str, Any] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class EmailProviderContext:
    parse_address: Any
    load_accounts: Any
    upsert_account: Any


@dataclass
class EmailQuery:
    address: EmailAddressInfo
    folder: str = "INBOX"
    from_filter: str = ""
    subject_filter: str = ""
    contains_filter: str = ""
    time_config: dict[str, Any] = field(default_factory=dict)
    wait_config: dict[str, Any] = field(default_factory=dict)
    extraction_config: dict[str, Any] | None = None
    alias_policy: str = "auto"
    account_tag: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "address": self.address.to_dict(),
            "folder": self.folder,
            "from": self.from_filter,
            "subject": self.subject_filter,
            "contains": self.contains_filter,
            "time": self.time_config,
            "wait": self.wait_config,
            "extraction": self.extraction_config,
            "aliasPolicy": self.alias_policy,
            "accountTag": self.account_tag,
        }


@dataclass
class ResolvedEmailTarget:
    provider: str
    source_type: str
    address_info: EmailAddressInfo | None = None
    account: EmailAccountRecord | None = None
    input_address: str | None = None
    resolved_address: str | None = None
    alias_address: str | None = None
    alias_label: str | None = None
    account_tag: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "sourceType": self.source_type,
            "addressInfo": self.address_info.to_dict() if self.address_info else None,
            "account": self.account.to_dict() if self.account else None,
            "inputAddress": self.input_address,
            "resolvedAddress": self.resolved_address,
            "aliasAddress": self.alias_address,
            "aliasLabel": self.alias_label,
            "accountTag": self.account_tag,
            "metadata": self.metadata,
        }


@dataclass
class EmailOperationPlan:
    action: str
    provider: str
    supported: bool
    target: ResolvedEmailTarget
    implementation: str
    generated_at: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "action": self.action,
            "provider": self.provider,
            "supported": self.supported,
            "implementation": self.implementation,
            "generatedAt": self.generated_at,
            "target": self.target.to_dict(),
            "details": self.details,
        }


@dataclass
class EmailMessage:
    id: str
    subject: str
    from_address: str
    to_addresses: list[str]
    date: datetime | None = None
    text: str | None = None
    html: str | None = None
    raw: Any = None
    provider_message_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["date"] = self.date.isoformat() if self.date else None
        return payload
