/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(
  async function test_the_titlebar_is_ours_on_macos_and_native_elsewhere() {
    await swellApp();
    const root = document.documentElement;
    const titlebar = document.getElementById("titlebar");
    if (Services.appinfo.OS == "Darwin") {
      Assert.ok(
        root.hasAttribute("customtitlebar"),
        "the native titlebar is hidden"
      );
      const style = getComputedStyle(titlebar);
      Assert.equal(style.display, "block");
      const css = await (
        await fetch("chrome://swell/content/window.css")
      ).text();
      Assert.ok(
        /:root\[customtitlebar\] #titlebar \{[^}]*-moz-window-dragging: drag/s.test(
          css
        ),
        "the strip is a drag region"
      );
      Assert.greaterOrEqual(
        parseInt(
          getComputedStyle(document.getElementById("sidebar")).paddingTop,
          10
        ),
        40,
        "the sidebar leaves room for the window controls"
      );
    } else {
      Assert.ok(
        !root.hasAttribute("customtitlebar"),
        "the native titlebar stays"
      );
      Assert.equal(getComputedStyle(titlebar).display, "none");
    }
  }
);
