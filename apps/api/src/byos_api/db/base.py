"""Single import surface for Alembic: pulls in Base and every model so that
`Base.metadata` is fully populated for autogenerate / migrations."""

from byos_api.core.db import Base
from byos_api.db import models  # noqa: F401  (registers all tables on Base.metadata)

__all__ = ["Base"]
