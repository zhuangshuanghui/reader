import json
import os
import shutil
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "usage: mobi_extract.py <source> <dest>"}))
        return 1

    source = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)

    try:
        import mobi
    except Exception as exc:
        print(json.dumps({"error": f"mobi package not available: {exc}"}))
        return 2

    try:
        tempdir, filepath = mobi.extract(str(source))
        tempdir_path = Path(tempdir)
        shutil.copytree(tempdir_path, dest, dirs_exist_ok=True)
        extracted_path = Path(filepath)
        relative = extracted_path.relative_to(tempdir_path)
        print(json.dumps({
            "entryPath": str(relative).replace("\\", "/"),
            "format": extracted_path.suffix.lstrip('.').lower(),
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
