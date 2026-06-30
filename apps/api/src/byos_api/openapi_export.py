"""Dump the FastAPI OpenAPI schema to a JSON file.

Used by the root `pnpm codegen` pipeline so the TS client can be generated
WITHOUT a running server:

    python -m byos_api.openapi_export ../../packages/api-client/openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from byos_api.main import app


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(app.openapi(), indent=2))
    print(f"Wrote OpenAPI schema to {out}")


if __name__ == "__main__":
    main()
