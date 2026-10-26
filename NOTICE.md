# Notices

Swell is licensed under the Mozilla Public License 2.0 (`LICENSE`).

## Gecko and Mozilla

Swell is an application built on Gecko, the engine of Mozilla Firefox, which is also
under the MPL 2.0 (https://www.mozilla.org/MPL/2.0/). The Firefox source tree is not part
of this repository: Swell is built inside a checkout of it, and the changes Swell makes to
Mozilla's files are the numbered patches in `patches/`, each under the licence of the file
it changes.

Swell is not affiliated with or endorsed by Mozilla. "Mozilla" and "Firefox" are trademarks
of the Mozilla Foundation; Swell does not use them as its name or branding. Its user agent
carries a `Firefox/<version>` compatibility token, as other Gecko-based browsers do, so that
sites treat the engine correctly.

## Bundled assets

| What | Licence | Where |
| --- | --- | --- |
| Atkinson Hyperlegible Next (font) | SIL Open Font License 1.1 | `app/content/fonts/OFL.txt` |
| Iconoir (icons) | MIT | `app/content/icons/LICENSE-iconoir` |
| emojibase-data 16.0.3 (emoji names and keywords, from Unicode CLDR) | MIT; Unicode License v3 | `app/content/emoji-data-LICENSE` |

## Rust dependencies

The core (`core/`) uses the crates listed, with their licences, in
`docs/third-party-rust.md` (regenerate with `tools/third-party.py`). All are under MIT,
Apache-2.0, MPL-2.0, Zlib, Unlicense or Unicode terms, or a choice that includes one of them.
