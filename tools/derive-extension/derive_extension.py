#!/usr/bin/env python3
"""Derive a per-space copy of an add-on from a .xpi.

usage: derive_extension.py in.xpi --space SPACE [-o OUTDIR] [--suffix-name]

Writes <derived-id>.xpi and <derived-id>.json (the derived -> original mapping)
into OUTDIR. The copy is unsigned: it needs xpinstall.signatures.required=false.
"""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

# Same pattern as gIDTest in toolkit/mozapps/extensions/internal/XPIInstall.sys.mjs.
ID_RE = re.compile(
    r"^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}"
    r"|[a-z0-9-\._]*\@[a-z0-9-\._]+)$",
    re.I,
)
GUID_RE = re.compile(r"^\{([0-9a-f-]{36})\}$", re.I)
SPACE_RE = re.compile(r"^[a-z0-9]+$")
GUID_DOMAIN = "derived.swell.invalid"
FIXED_DATE = (1980, 1, 1, 0, 0, 0)
DROPPED = ("META-INF/", "mozilla-recommendation.json")
TEXT_SUFFIXES = (".js", ".mjs", ".json", ".html", ".htm")


class DeriveError(Exception):
    pass


def strip_comments(text):
    """Remove //-comments outside strings, as Extension.sys.mjs does when reading manifests."""
    out = []
    i, n = 0, len(text)
    stripped = False
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == '"':
                    break
                j += 1
            else:
                raise DeriveError("Invalid JSON: unterminated string literal")
            out.append(text[i : j + 1])
            i = j + 1
        elif c == "/":
            if text[i + 1 : i + 2] != "/":
                raise DeriveError("Invalid JSON: unexpected /")
            stripped = True
            j = text.find("\n", i + 2)
            i = n if j == -1 else j
        else:
            out.append(c)
            i += 1
    return "".join(out), stripped


def derive_id(original, space):
    if not SPACE_RE.match(space):
        raise DeriveError(f"space id {space!r} must match [a-z0-9]+")
    guid = GUID_RE.match(original)
    if guid:
        derived = f"{guid.group(1).lower()}--s{space}@{GUID_DOMAIN}"
    else:
        local, _, domain = original.partition("@")
        derived = f"{local}--s{space}@{domain}"
    if not ID_RE.match(derived):
        raise DeriveError(f"derived id {derived!r} is not a valid add-on id")
    return derived


def gecko_settings(manifest):
    for key in ("browser_specific_settings", "applications"):
        gecko = (manifest.get(key) or {}).get("gecko")
        if isinstance(gecko, dict) and gecko.get("id"):
            return key, gecko
    return None, None


def suffix_name(manifest, files, space, warnings):
    name = manifest.get("name", "")
    match = re.fullmatch(r"__MSG_(.+)__", name)
    if not match:
        manifest["name"] = f"{name} [{space}]"
        return
    key = match.group(1)
    patched = 0
    for path in list(files):
        if re.fullmatch(r"_locales/[^/]+/messages\.json", path):
            text, _ = strip_comments(files[path].decode("utf-8-sig"))
            messages = json.loads(text)
            entry = next((v for k, v in messages.items() if k.lower() == key.lower()), None)
            if entry and "message" in entry:
                entry["message"] = f"{entry['message']} [{space}]"
                files[path] = json.dumps(messages, indent=2, ensure_ascii=False).encode()
                patched += 1
    if not patched:
        warnings.append(f"name {name!r} has no matching locale message; left unchanged")


def scan_references(files, original, warnings):
    for path, data in sorted(files.items()):
        if path == "manifest.json" or not path.endswith(TEXT_SUFFIXES):
            continue
        if original.encode() in data:
            warnings.append(f"{path} mentions the original id {original}")


def derive(xpi_path, space, suffix=False):
    warnings = []
    with zipfile.ZipFile(xpi_path) as zf:
        files = {
            i.filename: zf.read(i)
            for i in zf.infolist()
            if not i.is_dir() and not i.filename.startswith(DROPPED)
        }
    if "manifest.json" not in files:
        raise DeriveError("no manifest.json (only WebExtensions are supported)")
    text, had_comments = strip_comments(files["manifest.json"].decode("utf-8-sig"))
    if had_comments:
        warnings.append("manifest.json had comments; they are dropped in the copy")
    manifest = json.loads(text)

    _, gecko = gecko_settings(manifest)
    if gecko is None:
        raise DeriveError("manifest has no browser_specific_settings.gecko.id")
    original = gecko["id"]
    derived = derive_id(original, space)

    for key in ("browser_specific_settings", "applications"):
        section = (manifest.get(key) or {}).get("gecko")
        if isinstance(section, dict):
            section["id"] = derived
            if section.pop("update_url", None):
                warnings.append(f"{key}.gecko.update_url removed; the copy is updated by Swell")

    if "storage" in manifest and "managed_schema" in manifest["storage"]:
        warnings.append("storage.managed_schema: managed storage and policies are keyed by the original id")
    if "nativeMessaging" in manifest.get("permissions", []) + manifest.get("optional_permissions", []):
        warnings.append(f"nativeMessaging: host manifests must allow the derived id {derived} or map it back to {original}")
    if suffix:
        suffix_name(manifest, files, space, warnings)
    scan_references(files, original, warnings)

    files["manifest.json"] = json.dumps(manifest, indent=2, ensure_ascii=False).encode()
    return original, derived, files, warnings


def write_xpi(path, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, files[name])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("xpi", type=Path)
    parser.add_argument("--space", required=True)
    parser.add_argument("-o", "--outdir", type=Path, default=Path("."))
    parser.add_argument("--suffix-name", action="store_true", help="append [space] to the displayed name")
    args = parser.parse_args(argv)
    try:
        original, derived, files, warnings = derive(args.xpi, args.space, args.suffix_name)
    except (DeriveError, zipfile.BadZipFile, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    args.outdir.mkdir(parents=True, exist_ok=True)
    out = args.outdir / f"{derived}.xpi"
    write_xpi(out, files)
    mapping = {"derived": derived, "original": original, "space": args.space}
    (args.outdir / f"{derived}.json").write_text(json.dumps(mapping, indent=2) + "\n")
    print(f"{original} -> {derived}\n  {out}")
    for w in warnings:
        print(f"  warning: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
