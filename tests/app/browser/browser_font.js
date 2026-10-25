/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The window is set in Epilogue, from a copy that is part of the application.

add_task(async function test_the_window_is_set_in_epilogue() {
  await swellApp();
  const faces = await document.fonts.load("13px Epilogue");
  Assert.equal(faces.length, 1, "the font is found in the application");
  Assert.equal(faces[0].status, "loaded", "and loaded");
  Assert.ok(document.fonts.check("600 13px Epilogue"), "in every weight");

  for (const selector of [
    "body",
    "#sidebar .new-tab",
    "#nav-address",
    "#commandbar-input",
    "#space-title",
    "#extensions-dialog button",
    ".nav-button",
  ]) {
    const element = document.querySelector(selector);
    Assert.ok(element, `${selector} exists`);
    Assert.ok(
      getComputedStyle(element).fontFamily.startsWith("Epilogue"),
      `${selector} is in Epilogue: ${getComputedStyle(element).fontFamily}`
    );
  }
  const response = await fetch("chrome://swell/content/fonts/OFL.txt");
  Assert.ok(response.ok, "the licence of the font is with it");
});
