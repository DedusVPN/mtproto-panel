from __future__ import annotations

from typing import Annotated, Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator


class VdsinaCreateServerBody(BaseModel):
    """Тело POST для заказа VPS: на входе snake_case и/или ключи как в User API (server-plan, ssh-key)."""

    model_config = ConfigDict(extra="ignore")

    datacenter: Annotated[int, Field(..., ge=1)]
    server_plan: Annotated[
        int,
        Field(
            ...,
            ge=1,
            validation_alias=AliasChoices("server_plan", "server-plan"),
            serialization_alias="server-plan",
        ),
    ]
    template: int | None = Field(None, ge=1)
    ssh_key: int | None = Field(
        None,
        ge=1,
        validation_alias=AliasChoices("ssh_key", "ssh-key"),
        serialization_alias="ssh-key",
    )
    host: str | None = Field(None, max_length=255)
    name: str | None = Field(None, max_length=255)
    backup: int | None = Field(None, ge=0)
    iso: int | None = Field(None, ge=0)
    cpu: int | None = Field(None, ge=0)
    ram: int | None = Field(None, ge=0)
    disk: int | None = Field(None, ge=0)
    gpu: int | None = Field(None, ge=0)
    autoprolong: bool = True

    @model_validator(mode="after")
    def boot_source_at_most_one(self) -> VdsinaCreateServerBody:
        n = sum(1 for x in (self.template, self.backup, self.iso) if x is not None)
        if n > 1:
            raise ValueError("Можно указать только одно из полей: template, backup, iso")
        return self

    def to_upstream_payload(self) -> dict[str, Any]:
        raw = self.model_dump(by_alias=True, exclude_none=True, exclude={"autoprolong"})
        out: dict[str, Any] = {}
        for k, v in raw.items():
            if k in ("cpu", "ram", "disk", "gpu") and isinstance(v, int) and v < 1:
                continue
            out[k] = v
        return out
