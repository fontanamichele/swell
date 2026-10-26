# Security

Isolation between spaces is the main promise of Swell, so a report that one space can see
another's data (cookies, storage, history, passwords, form data, extensions, permissions,
downloads) is the most important kind we can get.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting: on the
repository page choose **Security**, then **Report a vulnerability**. Include the steps, the
Swell version (Swell > About Swell) and your system.

You can expect an answer within a few days. Swell is an alpha built by a small team, so fixes
for the engine itself follow Mozilla's releases: Swell cannot ship a Gecko fix before Mozilla
does, and a report about Gecko itself is best sent to Mozilla
(https://www.mozilla.org/security/).

## Supported versions

Only the latest release is supported.

## What is out of scope

- Findings that need a modified build, a compromised machine or physical access.
- The security of the websites you visit.
- Features that are not built yet (see the README), and the alpha's unsigned macOS build.
