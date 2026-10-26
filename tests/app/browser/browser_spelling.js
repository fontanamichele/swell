/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_spell.html`;
const menu = () => document.getElementById("menu");
const labels = () =>
  [...menu().querySelectorAll("button")].map(b => b.textContent);

add_task(
  async function test_a_misspelled_word_offers_suggestions_and_is_replaced() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Spelling");
    const tab = await openInSpace(bridge, space.id, PAGE);
    await SpecialPowers.spawn(tab.browser, [], async () => {
      const field = content.document.getElementById("field");
      field.focus();
      await new Promise(resolve => content.setTimeout(resolve, 1500));
    });

    let suggestions;
    await rendered(
      async () => {
        await BrowserTestUtils.synthesizeMouse(
          "#field",
          16,
          14,
          { type: "contextmenu", button: 2 },
          tab.browser
        );
        await rendered(() => !menu().hidden, "the menu opens", 100, 100);
        suggestions = labels();
        if (suggestions.includes("the")) {
          return true;
        }
        menu().hidden = true;
        return false;
      },
      "the word gets suggestions",
      100,
      300
    );

    [...menu().querySelectorAll("button")]
      .find(b => b.textContent == "the")
      .click();
    await rendered(
      async () =>
        (await SpecialPowers.spawn(
          tab.browser,
          [],
          () => content.document.getElementById("field").value
        )) == "the",
      "the suggestion replaces the word"
    );
    Assert.ok(
      suggestions.every(label => label != "No suggestions"),
      "the menu offered real suggestions"
    );
    await closeAllTabs(bridge);
  }
);
