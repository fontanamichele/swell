/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { FaviconLoader } from "resource:///modules/FaviconLoader.sys.mjs";

/**
 * Finds a page's icon links and loads the icon from inside the page's own
 * process, so the request carries the tab's container. What was loaded goes
 * to the window as a message.
 */
export class SwellLinkChild extends JSWindowActorChild {
  #seenTabIcon = false;
  #iconLoader = null;

  get iconLoader() {
    this.#iconLoader ??= new FaviconLoader(this);
    return this.#iconLoader;
  }

  #addRootIcon() {
    if (this.#seenTabIcon) {
      return;
    }
    const pageURI = this.document.documentURIObject;
    if (["http", "https"].includes(pageURI.scheme)) {
      this.#seenTabIcon = true;
      this.iconLoader.addDefaultIcon(pageURI);
    }
  }

  #onHeadParsed(event) {
    if (event.target.ownerDocument != this.document) {
      return;
    }
    // Icons belong in <head>, so all have been seen by now: add the site's
    // default icon if the page named none.
    this.#addRootIcon();
    this.#iconLoader?.onPageShow();
  }

  #onPageShow(event) {
    if (event.target != this.document) {
      return;
    }
    this.#addRootIcon();
    this.#iconLoader?.onPageShow();
  }

  #onPageHide(event) {
    if (event.target != this.document) {
      return;
    }
    this.#iconLoader?.onPageHide();
    this.#seenTabIcon = false;
  }

  #onLinkEvent(event) {
    const link = event.target;
    // Ignore sub-frames.
    if (link.documentGlobal != this.contentWindow) {
      return;
    }
    const rel = link.rel && link.rel.toLowerCase();
    if (!rel || !link.href || !link.getAttribute("href")) {
      return;
    }
    const rels = new Set(rel.split(/\s+/));
    if (
      rels.has("icon") &&
      !link.hasAttribute("color") &&
      !rel.includes("mask")
    ) {
      if (this.iconLoader.addIconFromLink(link, false)) {
        this.#seenTabIcon = true;
      }
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case "pageshow":
        this.#onPageShow(event);
        break;
      case "pagehide":
        this.#onPageHide(event);
        break;
      case "DOMHeadElementParsed":
        this.#onHeadParsed(event);
        break;
      default:
        this.#onLinkEvent(event);
    }
  }
}
