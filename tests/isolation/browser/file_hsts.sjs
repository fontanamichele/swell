"use strict";

function handleRequest(request, response) {
  response.setHeader("Content-Type", "text/plain", false);
  response.setHeader("Strict-Transport-Security", "max-age=300", false);
  response.write("hsts");
}
