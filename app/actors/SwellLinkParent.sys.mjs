/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const PREFERRED_WIDTH = 32;
// A data URI longer than this is not worth keeping in the sidebar database.
const MAX_ICON_LENGTH = 64 * 1024;

/**
 * Draws the frame of a decoded icon closest to the size the sidebar uses.
 *
 * @param {Document} doc
 * @param {Array} images Decoded frames from the content process.
 * @returns {Promise<string>} A PNG data URI.
 */
async function drawBest(doc, images) {
  const best = images.reduce((a, b) =>
    Math.abs(b.displayWidth - PREFERRED_WIDTH) <
    Math.abs(a.displayWidth - PREFERRED_WIDTH)
      ? b
      : a
  );
  const frame = new VideoFrame(await best.blob.bytes(), {
    timestamp: 0,
    format: best.format,
    codedWidth: best.displayWidth,
    codedHeight: best.displayHeight,
  });
  const canvas = doc.createElement("canvas");
  canvas.width = frame.displayWidth;
  canvas.height = frame.displayHeight;
  canvas.getContext("2d").drawImage(frame, 0, 0);
  frame.close();
  return canvas.toDataURL();
}

/**
 * The window's side of SwellLink: turns a loaded icon into a data URI and
 * hands it to the tab. Nothing goes to Places, whose icon store is shared by
 * the whole profile.
 */
export class SwellLinkParent extends JSWindowActorParent {
  async receiveMessage({ name, data }) {
    if (name != "Link:SetIcon" || data.isRichIcon) {
      return;
    }
    const browser = this.browsingContext.top.embedderElement;
    const win = browser?.documentGlobal;
    if (!win?.SwellApp) {
      return;
    }
    let icon;
    try {
      icon = data.images?.length
        ? await drawBest(win.document, data.images)
        : data.iconURL;
    } catch (e) {
      console.error("Swell: could not draw an icon", e);
      return;
    }
    if (!icon?.startsWith("data:image/") || icon.length > MAX_ICON_LENGTH) {
      return;
    }
    const { app } = await win.SwellApp.ready;
    app.setTabIcon(browser, icon);
  }
}
