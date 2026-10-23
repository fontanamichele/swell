import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import derive_extension as d


def make_xpi(path, manifest_text, extra=None):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("manifest.json", manifest_text)
        zf.writestr("META-INF/mozilla.rsa", "sig")
        zf.writestr("mozilla-recommendation.json", "{}")
        for name, data in (extra or {}).items():
            zf.writestr(name, data)


class DeriveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def run_tool(self, manifest, extra=None, space="a", *flags):
        xpi = self.tmp / "in.xpi"
        make_xpi(xpi, manifest if isinstance(manifest, str) else json.dumps(manifest), extra)
        out = self.tmp / "out"
        code = d.main([str(xpi), "--space", space, "-o", str(out), *flags])
        return code, out

    def read(self, out, derived):
        with zipfile.ZipFile(out / f"{derived}.xpi") as zf:
            return json.loads(zf.read("manifest.json")), zf.namelist()

    def test_email_style_id(self):
        self.assertEqual(d.derive_id("ublock0@raymondhill.net", "a"), "ublock0--sa@raymondhill.net")

    def test_guid_id(self):
        self.assertEqual(
            d.derive_id("{0A75D802-9AED-41E7-8DAA-24C067386E82}", "b2"),
            "0a75d802-9aed-41e7-8daa-24c067386e82--sb2@derived.swell.invalid",
        )

    def test_derived_ids_match_firefox_regex(self):
        for original in ("a@b.c", "@x.y", "{0a75d802-9aed-41e7-8daa-24c067386e82}"):
            self.assertTrue(d.ID_RE.match(d.derive_id(original, "s1")))

    def test_bad_space(self):
        with self.assertRaises(d.DeriveError):
            d.derive_id("a@b.c", "A_b")

    def test_rewrites_both_sections_and_drops_signature(self):
        manifest = {
            "name": "N",
            "browser_specific_settings": {"gecko": {"id": "x@y.z", "update_url": "https://u"}},
            "applications": {"gecko": {"id": "x@y.z"}},
        }
        code, out = self.run_tool(manifest)
        self.assertEqual(code, 0)
        derived, names = self.read(out, "x--sa@y.z")
        self.assertEqual(derived["browser_specific_settings"]["gecko"]["id"], "x--sa@y.z")
        self.assertEqual(derived["applications"]["gecko"]["id"], "x--sa@y.z")
        self.assertNotIn("update_url", derived["browser_specific_settings"]["gecko"])
        self.assertEqual(names, ["manifest.json"])
        mapping = json.loads((out / "x--sa@y.z.json").read_text())
        self.assertEqual(mapping["original"], "x@y.z")

    def test_comments_in_manifest(self):
        text = '{\n // note\n "name": "N", "browser_specific_settings": {"gecko": {"id": "x@y.z"}}\n}'
        code, out = self.run_tool(text)
        self.assertEqual(code, 0)
        self.read(out, "x--sa@y.z")

    def test_slash_inside_string_is_kept(self):
        text = '{"name": "a//b", "browser_specific_settings": {"gecko": {"id": "x@y.z"}}}'
        code, out = self.run_tool(text)
        derived, _ = self.read(out, "x--sa@y.z")
        self.assertEqual(derived["name"], "a//b")

    def test_missing_id_fails(self):
        code, _ = self.run_tool({"name": "N"})
        self.assertEqual(code, 1)

    def test_suffix_name_plain_and_localized(self):
        base = {"browser_specific_settings": {"gecko": {"id": "x@y.z"}}}
        code, out = self.run_tool({**base, "name": "N"}, None, "a", "--suffix-name")
        self.assertEqual(self.read(out, "x--sa@y.z")[0]["name"], "N [a]")
        loc = {"_locales/en/messages.json": json.dumps({"extName": {"message": "Loc"}})}
        code, out = self.run_tool({**base, "name": "__MSG_extName__"}, loc, "b", "--suffix-name")
        with zipfile.ZipFile(out / "x--sb@y.z.xpi") as zf:
            msgs = json.loads(zf.read("_locales/en/messages.json"))
        self.assertEqual(msgs["extName"]["message"], "Loc [b]")

    def test_deterministic_output(self):
        manifest = {"name": "N", "browser_specific_settings": {"gecko": {"id": "x@y.z"}}}
        self.run_tool(manifest, {"b.js": "1", "a.js": "2"})
        first = (self.tmp / "out" / "x--sa@y.z.xpi").read_bytes()
        self.run_tool(manifest, {"b.js": "1", "a.js": "2"})
        self.assertEqual(first, (self.tmp / "out" / "x--sa@y.z.xpi").read_bytes())

    def test_reference_scan_warns(self):
        manifest = {"name": "N", "browser_specific_settings": {"gecko": {"id": "x@y.z"}}}
        xpi = self.tmp / "in.xpi"
        make_xpi(xpi, json.dumps(manifest), {"bg.js": "runtime.sendMessage('x@y.z')"})
        _, _, _, warnings = d.derive(xpi, "a")
        self.assertTrue(any("bg.js" in w for w in warnings))


if __name__ == "__main__":
    unittest.main()
