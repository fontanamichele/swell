#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.

"""Writes the synthetic StorableSidebar.json used by the importer tests.

The structure follows docs/ARCHITECTURE.md ("Arc sidebar file format"); every
title and URL is invented. usage: make_arc_fixture.py OUT.json
"""

import json
import sys


def pairs(d):
    out = []
    for k, v in d.items():
        out += [k, v]
    return out


items = {}


def tab(
    id,
    parent,
    url,
    title=None,
    saved_title=None,
    created=700000000.0,
    active=700000100.0,
):
    items[id] = {
        "id": id,
        "parentID": parent,
        "childrenIds": [],
        "title": title,
        "createdAt": created,
        "isUnread": False,
        "originatingDevice": "dev-1",
        "data": {
            "tab": {
                "savedURL": url,
                "savedTitle": saved_title,
                "timeLastActiveAt": active,
            }
        },
    }
    items[parent]["childrenIds"].append(id)


def folder(id, parent, title):
    items[id] = {
        "id": id,
        "parentID": parent,
        "childrenIds": [],
        "title": title,
        "createdAt": 700000000.0,
        "isUnread": False,
        "originatingDevice": "dev-1",
        "data": {"list": {}},
    }
    items[parent]["childrenIds"].append(id)


def container(id, kind):
    items[id] = {
        "id": id,
        "parentID": None,
        "childrenIds": [],
        "title": None,
        "createdAt": 700000000.0,
        "isUnread": False,
        "originatingDevice": "dev-1",
        "data": {"itemContainer": {"containerType": kind}},
    }


for sid in ("s1", "s2", "s3"):
    container(f"{sid}-pinned", {"spaceItems": {"_0": sid}})
    container(f"{sid}-today", {"spaceItems": {"_0": sid}})
container("top-default", {"topApps": {"_0": {"default": True}}})
container(
    "top-custom",
    {
        "topApps": {
            "_0": {
                "custom": {"_0": {"directoryBasename": "Profile 1", "machineID": "m1"}}
            }
        }
    },
)

# Space s1 "Work": folder, titled tab, dangling child, unknown item kind
folder("s1-f-docs", "s1-pinned", "Docs été")
tab("s1-t-doc", "s1-f-docs", "https://docs.example.test/a", saved_title="Doc A")
tab(
    "s1-t-drive",
    "s1-f-docs",
    "https://drive.example.test/",
    title="My Drive",
    saved_title="Drive",
)
tab("s1-t-mail", "s1-pinned", "https://mail.example.test/", saved_title="中文 Mail")
items["s1-pinned"]["childrenIds"].append("missing-id")
items["s1-easel"] = {
    "id": "s1-easel",
    "parentID": "s1-pinned",
    "childrenIds": [],
    "title": "Easel",
    "createdAt": 700000000.0,
    "isUnread": False,
    "originatingDevice": "dev-1",
    "data": {"easel": {}},
}
items["s1-pinned"]["childrenIds"].append("s1-easel")
tab("s1-t-today1", "s1-today", "https://news.example.test/", saved_title="News")
tab("s1-t-empty", "s1-today", "", saved_title="Empty")
tab("s1-t-today2", "s1-today", "https://blog.example.test/post", saved_title="Post")

# Space s2 "Home": same profile as s1; nested folders; a folder in Today
tab("s2-t-1", "s2-pinned", "https://home.example.test/", saved_title="Home")
folder("s2-f-a", "s2-pinned", "A")
folder("s2-f-b", "s2-f-a", "B")
tab("s2-t-deep", "s2-f-b", "https://deep.example.test/", saved_title="Deep")
folder("s2-f-today", "s2-today", "Stray folder")
tab("s2-t-today", "s2-f-today", "https://stray.example.test/", saved_title="Stray")

# Space s3 "Client": custom profile, legacy containerIDs field
tab("s3-t-1", "s3-pinned", "https://client.example.test/", saved_title="Client")
tab(
    "s3-t-today",
    "s3-today",
    "https://client.example.test/today",
    saved_title="Client Today",
)

# Favorites
tab("fav-default-1", "top-default", "https://fav1.example.test/", saved_title="Fav 1")
tab("fav-default-2", "top-default", "https://fav2.example.test/", saved_title="Fav 2")
tab("fav-custom-1", "top-custom", "https://favc.example.test/", saved_title="Fav C")

default_profile = {"default": True}
custom_profile = {
    "custom": {"_0": {"directoryBasename": "Profile 1", "machineID": "m1"}}
}
spaces = {
    "s1": {
        "id": "s1",
        "title": "Work",
        "customInfo": {"iconType": {"emoji_v2": "\U0001f4bc", "emoji": 0}},
        "profile": default_profile,
        "newContainerIDs": [
            {"pinned": {}},
            "s1-pinned",
            {"unpinned": {"_0": {"shared": {}}}},
            "s1-today",
        ],
    },
    "s2": {
        "id": "s2",
        "title": "Home",
        "customInfo": {"iconType": {"icon": "house"}},
        "profile": default_profile,
        "newContainerIDs": [
            {"pinned": {}},
            "s2-pinned",
            {"unpinned": {"_0": {"shared": {}}}},
            "s2-today",
        ],
    },
    "s3": {
        "id": "s3",
        "title": "Client",
        "customInfo": {"iconType": {"icon": "star"}},
        "profile": custom_profile,
        "containerIDs": ["pinned", "s3-pinned", "unpinned", "s3-today"],
    },
}
doc = {
    "sidebar": {
        "containers": [
            {"global": {}},
            {
                "items": pairs(items),
                "spaces": pairs(spaces),
                "topAppsContainerIDs": [
                    default_profile,
                    "top-default",
                    custom_profile,
                    "top-custom",
                ],
            },
        ]
    },
    "firebaseSyncState": {
        "syncData": {
            "orderedSpaceIDs": {"value": ["s2", "s1"]},
            "items": pairs({
                k: {"value": v, "lastChangeDate": 1.0, "lastChangedDevice": "dev-1"}
                for k, v in items.items()
                if not k.startswith("s3")
            }),
        }
    },
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
