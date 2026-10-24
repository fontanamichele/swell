"use strict";

function handleRequest(request, response) {
  let count = 1 + parseInt(getState("count") || "0", 10);
  setState("count", String(count));
  response.setHeader("Content-Type", "text/plain", false);
  response.setHeader("Cache-Control", "max-age=3600", false);
  response.write(String(count));
}
