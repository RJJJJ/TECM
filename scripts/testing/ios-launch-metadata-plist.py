import plistlib
import sys
from pathlib import Path


LAUNCH_KEYS = (
    "UILaunchScreen",
    "UILaunchScreens",
    "UILaunchStoryboardName",
    "UILaunchStoryboards",
)


def load_plist(path: Path) -> tuple[dict[str, object], plistlib.PlistFormat]:
    contents = path.read_bytes()
    plist_format = plistlib.FMT_BINARY if contents.startswith(b"bplist00") else plistlib.FMT_XML
    parsed = plistlib.loads(contents)
    if not isinstance(parsed, dict):
        raise ValueError("root plist value must be a dictionary")
    return parsed, plist_format


def validate(path: Path) -> int:
    try:
        plist, _ = load_plist(path)
    except (OSError, plistlib.InvalidFileException, ValueError):
        return 1

    if isinstance(plist.get("UILaunchScreen"), dict):
        print("UILaunchScreen dictionary")
        return 0
    if isinstance(plist.get("UILaunchScreens"), dict):
        print("UILaunchScreens dictionary")
        return 0
    for key in ("UILaunchStoryboardName", "UILaunchStoryboards"):
        value = plist.get(key)
        if isinstance(value, str) and value.strip():
            print(key)
            return 0
    return 1


def mutate(path: Path) -> int:
    try:
        plist, plist_format = load_plist(path)
        for key in LAUNCH_KEYS:
            plist.pop(key, None)
        path.write_bytes(plistlib.dumps(plist, fmt=plist_format, sort_keys=False))
    except (OSError, plistlib.InvalidFileException, ValueError):
        return 1
    return 0


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in {"validate", "mutate"}:
        print(f"usage: {Path(sys.argv[0]).name} <validate|mutate> <Info.plist>", file=sys.stderr)
        return 64

    path = Path(sys.argv[2])
    if sys.argv[1] == "validate":
        return validate(path)
    return mutate(path)


if __name__ == "__main__":
    raise SystemExit(main())
