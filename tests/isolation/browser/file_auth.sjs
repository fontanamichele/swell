"use strict";

function handleRequest(request, response) {
  response.setHeader("Content-Type", "text/plain", false);
  if (request.hasHeader("Authorization")) {
    response.write("authorized");
    return;
  }
  response.setStatusLine(request.httpVersion, 401, "Unauthorized");
  response.setHeader("WWW-Authenticate", 'Basic realm="swell"', false);
  response.write("unauthorized");
}
