/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

function handleRequest(request, response) {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.setHeader("Content-Type", "application/octet-stream", false);
  response.setHeader(
    "Content-Disposition",
    "attachment; filename=swell-test.bin",
    false
  );
  response.write("swell download test");
}
