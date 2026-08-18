## Security Checklist

---

### Critical — zero tolerance (block delivery if any fail)
- [ ] No string concatenation in any query (SQL, NoSQL, LDAP, GraphQL)
- [ ] No unescaped user input rendered in HTML, templates, or client-side scripts
- [ ] No hardcoded secrets, passwords, or API keys in source code
- [ ] No sensitive data (passwords, tokens, full PII) in log output
- [ ] No unrestricted file paths derived from user input
- [ ] No shell command execution with unsanitized user input
- [ ] No missing authentication on state-changing endpoints
- [ ] No missing authorization — every action checks permissions
- [ ] No detailed error messages or stack traces exposed to end users
- [ ] No high/critical vulnerabilities in dependencies (`npm audit` or equivalent passes)
- [ ] No unencrypted secrets in transit or at rest

---

### Input validation
- [ ] All user input validated server-side with a schema library (zod, valibot)
- [ ] No raw user input concatenated into SQL queries — parameterized queries or ORM used
- [ ] No raw user input injected into the DOM — `textContent` or sanitized HTML
- [ ] No user input used directly in file paths — path traversal check in place
- [ ] Mass assignment prevented — fields explicitly allowlisted
- [ ] Rate limiting applied to all public endpoints, stricter on auth routes
- [ ] CSRF protection in place — `sameSite: 'lax'` minimum, CSRF tokens for high-stakes operations
- [ ] State-changing endpoints (POST/PUT/DELETE) reject cross-origin requests without valid CSRF token

### File uploads
- [ ] MIME type detected from magic bytes — not from extension or request header
- [ ] Original filename never used — replaced with a random UUID
- [ ] File size limit enforced server-side
- [ ] Uploaded files stored outside the webroot — not in any publicly served directory
- [ ] Files served through a controller with auth check — not via static file serving
- [ ] `Content-Disposition: attachment` set when serving files — prevents inline execution

---

### Authentication
- [ ] Passwords hashed with bcrypt, argon2, scrypt, or PBKDF2 (appropriate work factor for your hardware) — never MD5/SHA
- [ ] JWT access tokens short-lived (configure based on your security requirements)
- [ ] JWT not stored in localStorage for sensitive tokens in browser apps — prefer httpOnly cookies; refresh token in httpOnly cookie
- [ ] Separate secrets for access and refresh tokens
- [ ] Login returns same message for wrong email and wrong password
- [ ] bcrypt.compare runs even when user is not found (timing attack prevention)
- [ ] Password reset tokens stored as hashes, not plain values
- [ ] Sessions use httpOnly, secure, sameSite cookies

---

### Authorization
- [ ] Every endpoint checks permissions server-side — not just in the UI
- [ ] Resource queries scoped to the authenticated user (IDOR prevention)
- [ ] Roles and permissions defined centrally, not scattered across endpoints
- [ ] 403 returned for unauthorized access — not 404 (no resource enumeration)
- [ ] Database user has only the permissions the app actually needs

---

### Data protection
- [ ] No secrets or API keys in source code or committed `.env` files
- [ ] `.env` files in `.gitignore`
- [ ] Environment variables validated at startup (fail fast on missing secrets)
- [ ] No passwords, tokens, or full PII in logs
- [ ] Sensitive fields encrypted at rest (not just hashed)
- [ ] Stack traces and internal error details not sent to client in production
- [ ] API responses scrubbed — no `passwordHash`, internal IDs, or schema-revealing field names
- [ ] `X-Powered-By` header removed (helmet does this automatically)
- [ ] `helmet` or equivalent security headers applied
- [ ] CORS allowlist explicit — no `*` in production unless intentionally serving a public API
- [ ] HTTPS enforced — no mixed content

---

### Dependencies
- [ ] `npm audit` (or your package manager's equivalent: `pip audit`, `cargo audit`, etc.) passes with no high/critical vulnerabilities
- [ ] Lockfile committed and up to date
- [ ] No unmaintained packages (last publish > 2 years ago)
- [ ] Dependabot or Renovate configured for automated update PRs
- [ ] No packages imported beyond what is actually used