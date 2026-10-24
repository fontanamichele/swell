/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What LoginManagerParent asks when a submitted form holds a login worth
// keeping or changing (signon.prompterModuleURI names this module). Firefox
// answers with a doorhanger; Swell's window answers through the handler it
// registers here. A login is only ever written to the container of the page
// that submitted it.

import { LoginHelper } from "resource://gre/modules/LoginHelper.sys.mjs";

let handler = null;

export const LoginPromptHandler = {
  /**
   * @param {Function} fn Called with `{browser, update, login, oldLogin}`;
   *   resolves with "save", "never" or anything else for "not now".
   */
  set(fn) {
    handler = fn;
  },
};

function containerOf(browser) {
  return browser?.browsingContext?.originAttributes.userContextId ?? 0;
}

async function promptToSave(browser, login) {
  const userContextId = containerOf(browser);
  const logins = LoginHelper.loginsFor(userContextId);
  const answer = await handler?.({ browser, update: false, login });
  if (answer == "save") {
    await logins.addLoginAsync(login);
  } else if (answer == "never") {
    logins.setLoginSavingEnabled(login.origin, false);
  }
}

async function promptToChange(browser, oldLogin, newLogin) {
  const logins = LoginHelper.loginsFor(containerOf(browser));
  const answer = await handler?.({
    browser,
    update: true,
    login: newLogin,
    oldLogin,
  });
  if (answer == "save") {
    await logins.modifyLoginAsync(oldLogin, newLogin);
  } else if (answer == "never") {
    logins.setLoginSavingEnabled(newLogin.origin, false);
  }
}

export const LoginPrompter = {
  promptToSavePassword(browser, login) {
    if (!browser || !handler) {
      return null;
    }
    promptToSave(browser, login).catch(e =>
      console.error("Swell: saving a login failed", e)
    );
    return null;
  },

  promptToChangePassword(browser, oldLogin, newLogin) {
    if (!browser || !handler) {
      return null;
    }
    promptToChange(browser, oldLogin, newLogin).catch(e =>
      console.error("Swell: changing a login failed", e)
    );
    return null;
  },

  // The page did not say which account changes its password; the first
  // saved login of the site is the one offered.
  async promptToChangePasswordWithUsernames(browser, logins, newLogin) {
    if (!browser || !handler || !logins.length) {
      return null;
    }
    const [oldLogin] = logins;
    newLogin.username = oldLogin.username;
    newLogin.usernameField = oldLogin.usernameField;
    await promptToChange(browser, oldLogin, newLogin);
    return null;
  },
};
