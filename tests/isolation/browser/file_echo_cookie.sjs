"use strict";

function handleRequest(request, response) {
  response.setHeader("Content-Type", "text/plain", false);
  response.setHeader("Cache-Control", "no-store", false);
  response.write(request.hasHeader("Cookie") ? request.getHeader("Cookie") : "");
}
