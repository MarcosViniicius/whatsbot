"""Settings declarativas do plugin Pedidos (Kanban)."""

from pydantic import BaseModel, Field


class Settings(BaseModel):
    default_currency: str = Field(
        default="BRL",
        description="Moeda padrão exibida nos cartões quando o pedido não informa uma.",
    )
