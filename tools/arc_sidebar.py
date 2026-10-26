#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Rebuild Arc's sidebar (Favorites, Spaces > Pinned / Today > folders > tabs)
from StorableSidebar.json, and optionally export it as bookmarks HTML.

usage: arc_sidebar.py StorableSidebar.json [--html out.html] [--redact]
"""
import argparse
import datetime
import html
import json
import sys
from urllib.parse import urlsplit

APPLE_EPOCH = datetime.datetime(2001, 1, 1, tzinfo=datetime.timezone.utc)


def pairs(lst):
    """Swift encodes non-String-keyed dictionaries as [k1, v1, k2, v2, ...]."""
    return dict(zip(lst[0::2], lst[1::2]))


def apple_time(t):
    return (APPLE_EPOCH + datetime.timedelta(seconds=t)) if t else None


def profile_name(p):
    if p.get("default"):
        return "Default"
    return p.get("custom", {}).get("_0", {}).get("directoryBasename", "?")


def container_kind(entry):
    # newContainerIDs entries: {"pinned": {}} or {"unpinned": {"_0": {"shared": {}}}}
    if isinstance(entry, dict):
        return next(iter(entry))
    return entry  # legacy containerIDs: "pinned" / "unpinned"


class Sidebar:
    def __init__(self, doc, redact=False):
        live = next(c for c in doc["sidebar"]["containers"] if "items" in c)
        self.items = pairs(live["items"])
        self.spaces = pairs(live["spaces"])
        # keys are profile dicts (unhashable), so keep as (profile, containerID) pairs
        self.top_apps = list(zip(live["topAppsContainerIDs"][0::2], live["topAppsContainerIDs"][1::2]))
        fb = doc.get("firebaseSyncState", {}).get("syncData", {})
        order = fb.get("orderedSpaceIDs", {}).get("value") or list(self.spaces)
        self.space_order = [s for s in order if s in self.spaces] + [s for s in self.spaces if s not in order]
        self.synced_ids = set(pairs(fb.get("items", [])))
        self.redact = redact
        self._n = 0

    # ---- labels
    def label(self, item):
        d = item["data"]
        if "list" in d:
            return "📁 " + (("Folder %d" % self._bump()) if self.redact else (item.get("title") or "(untitled folder)"))
        if "tab" in d:
            t = d["tab"]
            title = item.get("title") or t.get("savedTitle") or "(untitled)"
            url = t.get("savedURL") or ""
            if self.redact:
                host = urlsplit(url).hostname or "?"
                return "• tab %d  [%s]" % (self._bump(), "x" * min(len(host), 8))
            return "• %s  <%s>" % (title, url)
        return "? " + next(iter(d))

    def _bump(self):
        self._n += 1
        return self._n

    # ---- tree walk
    def walk(self, node_id, depth, out):
        node = self.items.get(node_id)
        if node is None:
            out.append("  " * depth + "!! missing " + node_id)
            return
        for cid in node["childrenIds"]:
            child = self.items.get(cid)
            if child is None:
                out.append("  " * depth + "!! missing " + cid)
                continue
            mark = "" if cid in self.synced_ids else "  (local only)"
            out.append("  " * depth + self.label(child) + mark)
            if "list" in child["data"]:
                self.walk(cid, depth + 1, out)

    def outline(self):
        out = ["== Favorites (per profile) =="]
        for prof, cid in self.top_apps:
            out.append("  [profile: %s]" % profile_name(prof))
            self.walk(cid, 2, out)
        for sid in self.space_order:
            sp = self.spaces[sid]
            title = ("Space %s" % sid[:4]) if self.redact else sp.get("title") or "(untitled space)"
            icon = sp.get("customInfo", {}).get("iconType", {})
            out.append("\n== Space: %s  (profile %s, icon %s) ==" % (title, profile_name(sp.get("profile", {})), json.dumps(icon)))
            ids = sp.get("newContainerIDs") or sp.get("containerIDs")
            for kind, cid in zip(ids[0::2], ids[1::2]):
                out.append("  -- %s --" % {"pinned": "Pinned", "unpinned": "Today"}.get(container_kind(kind), kind))
                self.walk(cid, 2, out)
        return "\n".join(out)

    # ---- Netscape bookmarks export (importable by Chrome/Safari/Firefox)
    def to_html(self):
        lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
                 '<TITLE>Arc Sidebar</TITLE>', '<H1>Arc Sidebar</H1>', '<DL><p>']

        def emit(cid, ind):
            for ch_id in self.items.get(cid, {}).get("childrenIds", []):
                ch = self.items.get(ch_id)
                if not ch:
                    continue
                d = ch["data"]
                pad = "    " * ind
                if "list" in d:
                    lines.append('%s<DT><H3>%s</H3>' % (pad, html.escape(ch.get("title") or "Folder")))
                    lines.append(pad + "<DL><p>")
                    emit(ch_id, ind + 1)
                    lines.append(pad + "</DL><p>")
                elif "tab" in d:
                    t = d["tab"]
                    ts = apple_time(ch.get("createdAt"))
                    add = ' ADD_DATE="%d"' % ts.timestamp() if ts else ""
                    lines.append('%s<DT><A HREF="%s"%s>%s</A>' % (pad, html.escape(t.get("savedURL", "")), add,
                                 html.escape(ch.get("title") or t.get("savedTitle") or "")))

        def folder(name, ind, ids):
            pad = "    " * ind
            lines.append('%s<DT><H3>%s</H3>' % (pad, html.escape(name)))
            lines.append(pad + "<DL><p>")
            for cid in ids:
                emit(cid, ind + 1)
            lines.append(pad + "</DL><p>")

        folder("Favorites", 1, [cid for _, cid in self.top_apps])
        for sid in self.space_order:
            sp = self.spaces[sid]
            ids = sp.get("newContainerIDs") or sp.get("containerIDs")
            pinned = [cid for k, cid in zip(ids[0::2], ids[1::2]) if container_kind(k) == "pinned"]
            folder(sp.get("title") or "Space", 1, pinned)
        lines.append("</DL><p>")
        return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--html")
    ap.add_argument("--redact", action="store_true")
    a = ap.parse_args()
    sb = Sidebar(json.load(open(a.file, encoding="utf-8")), redact=a.redact)
    print(sb.outline())
    if a.html:
        open(a.html, "w", encoding="utf-8").write(sb.to_html())
        print("\nwrote", a.html, file=sys.stderr)


if __name__ == "__main__":
    main()
