# derive-extension

M0 spike tool: turns an add-on `.xpi` into a per-space copy with a different ID.

    python3 derive_extension.py in.xpi --space a -o out/ [--suffix-name]

Test: `PYTHONPATH=. python3 -B -m unittest -v test_derive_extension`

## ID scheme

`~` is not a legal add-on ID character (`gIDTest` in
`toolkit/mozapps/extensions/internal/XPIInstall.sys.mjs`), so copies use:

- `local@domain` -> `local--s<space>@domain`
- `{guid}` -> `<guid>--s<space>@derived.swell.invalid`

`<space>` must match `[a-z0-9]+`. The tool exits with an error if the result would not
pass the Firefox ID pattern.

## What changes

- `browser_specific_settings.gecko.id` and legacy `applications.gecko.id` are rewritten.
- `update_url` is removed; the core updates all copies together.
- `META-INF/` (the signature, now invalid) and `mozilla-recommendation.json` are dropped.
- `manifest.json` is re-serialised (comments are dropped, with a warning).
- Output is deterministic (sorted entries, fixed timestamps).
- A `<derived-id>.json` file records `derived`, `original` and `space`.

The copy is unsigned and needs `xpinstall.signatures.required=false`.

## Warnings (not changed)

Files that mention the original ID, `storage.managed_schema`, and `nativeMessaging`
(host manifests list the original ID).
