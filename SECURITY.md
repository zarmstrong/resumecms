# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub's
[private vulnerability reporting](https://github.com/zarmstrong/resumecms/security/advisories/new)
(the repository's **Security** tab, then **Report a vulnerability**).
Don't open a public issue or pull request for one.

A useful report says:

- what an attacker can do, and what they need first (a login, the MCP
  token, a crafted upload, a particular `Host` header);
- how to reproduce it, against a fresh install if you can;
- the version (shown in the editor's top bar, or the image tag).

This is a one-maintainer project, so replies are best effort. Once a fix
ships, the advisory is published with credit to the reporter, unless you'd
rather not be named.

## Supported versions

Fixes go into the latest release only, published as a new
`zacharmstrong/resumecms` image (`X.Y.Z`, `X.Y`, `X` and `latest`). Update
to it rather than patching an older one.

## Scope

In scope: the server, the editor and public site, the MCP endpoint, PDF
rendering, and the Docker image as published.

Out of scope:

- an install whose operator weakened it on purpose, such as an
  `RESUMECMS_TRUST_PROXY` that trusts more than their own proxy (see
  "Logging and security" in the [README](README.md));
- what a logged-in owner can do with their own install, since the editor
  has a single user who controls all of its content;
- the AI providers, captcha providers and media sites the app talks to;
- denial of service by sheer request volume.

The README's "Logging and security", "Editor sessions" and "Two-factor
authentication" sections describe how the app is meant to be deployed.
