---
name: security
description: Check ANY code for SQL injection, XSS, command injection, secrets, path traversal. Internal code too.
---

> **Note:** Examples use Node.js/Express syntax. Apply the same security principles with your project's language and framework.

## Zero tolerance policy

These are never acceptable in any code, regardless of context:

- String concatenation in SQL/NoSQL queries → always use parameterized queries
- Unescaped user input in HTML/templates → always sanitize or use framework auto-escaping
- Hardcoded secrets, passwords, API keys in source code → always use environment variables
- Sensitive data (passwords, tokens, PII) in logs → always redact before logging
- Unrestricted file paths from user input → always validate and sandbox
- Shell command execution with user input → always use safe APIs, never string interpolation
- Missing authentication on endpoints that modify data → always verify identity
- Missing authorization checks → always verify permissions before acting
- Detailed error messages to end users → always return generic messages, log details server-side

Violations of these rules must be fixed immediately — they are never acceptable
as "we'll fix it later" or "it's just internal code."

## Core principles (always apply)

- **Never trust input**: validate and sanitize everything that comes from outside
  the system — user input, query params, headers, external APIs, file uploads
- **Internal code becomes external code**: a function that is "internal" today
  is exposed tomorrow when an API is added, a route is changed, or inputs are
  chained. Validate at every boundary, not just the outermost one.
- **Least privilege**: every component gets only the permissions it actually needs
- **Defense in depth**: never rely on a single security layer — stack multiple controls
- **Fail securely**: on error, default to denying access — never to allowing it
- **Secrets never in code**: no API keys, passwords, or tokens in source files

## When to load reference files

- Handling any input from users, query params, forms, or external APIs
  → read `references/input-validation.md`

- Implementing login, registration, tokens, sessions, or password flows
  → read `references/authentication.md`

- Checking permissions, roles, or access control
  → read `references/authorization.md`

- Storing, transmitting, or logging sensitive data, secrets, or credentials
  → read `references/data-protection.md`

- Installing, updating, or auditing third-party packages
  → read `references/dependencies.md`

- Doing a full security review
  → read `assets/security-checklist.md`

## Gotchas

- Validation on the frontend is UX — validation on the backend is security.
  Always validate server-side, even if the frontend already does it.
- An endpoint that returns 404 for unauthorized access instead of 403
  leaks the existence of resources to attackers — return 403 consistently.
- Logging is not a security control — don't rely on logs to catch attacks,
  use them to investigate after the fact.
- `HTTPS` encrypts data in transit — it doesn't protect data at rest or
  prevent injection attacks. It's necessary but not sufficient.
- Rate limiting and input validation are not alternatives — you need both.
