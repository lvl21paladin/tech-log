---
title: "TryHackMe - Byte Lotus: Concierge Briefing"
date: 2026-07-28
tags: ["TryHackMe", "Penetration Testing", "Web Security", "Directory Enumeration", "Git"]
excerpt: "Fixing a gobuster status-code flag conflict, spotting an exposed .git directory the wordlist scan missed, and dumping it to recover a staging flag left in a README."
---


# TryHackMe: Byte Lotus — Concierge Briefing 

**Room theme:** Byte Lotus, a hotel guest-experience platform that "went live in a hurry." Task 1 tags: *Web*, *Directory Enumeration*.

**Goal:** Dump the exposed source code, find the flag.

## Recon

Target: `http://10.113.134.116:8080`. Nmap showed only two open ports: 22 (SSH) and 8080 (the web app).

First pass was a gobuster directory scan using `directory-list-2.3-small.txt` with default settings — no hits. That result was misleading rather than conclusive: the small wordlist has no file extensions and gobuster's default status-code filtering can hide useful responses (like 403s) as if nothing were there.

## Fixing the enumeration approach

Re-ran with the medium wordlist and extensions (`-x php,html,json,txt`), which surfaced a gobuster quirk worth noting for future scans: the tool errors if you don't explicitly resolve the whitelist/blacklist status-code flags. By default `--status-codes-blacklist` is `"404"`, which conflicts with an explicit `-s` whitelist unless you also clear the blacklist in the *same* command:

```
gobuster dir -u http://10.113.134.116:8080 \
  -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt \
  -x php,html,json,txt \
  -s "200,204,301,302,307,401,403,500" \
  --status-codes-blacklist="" \
  -t 30
```

Setting only one of the two flags at a time throws "both set" or "both not set" errors — they have to be passed together in one invocation.

## Finding the real hole: exposed `.git`

Directory wordlists rarely include dotfiles like `.git`, so brute forcing alone wasn't going to find it. The room's flavor text — "the night-shift developer shipped more than the website" — was the actual clue: check for a leaked `.git` directory directly rather than relying on the wordlist.

```
curl -s http://10.113.134.116:8080/.git/HEAD
```

Returned:

```
ref: refs/heads/main
```

That confirmed the entire `.git` folder was served publicly by the web root — a deploy mistake, not something a wordlist scan would catch.

## Dumping the repo

Used `git-dumper` to walk the exposed git objects and reconstruct a working copy:

```
pip install git-dumper
git-dumper http://10.113.134.116:8080/.git ./byte-lotus-src
```

It fetched `HEAD`, `config`, `logs`, `refs`, and the object store, then ran `git checkout .` to materialize the files. Turned out to be a tiny single-commit repo — three files: `README.md`, `app.js`, `index.html`.

## The flag

It was sitting in plain text in `README.md`:

```
Staging flag (remove before launch): THM{byt3_l0tus_n3v3r_f0rg3ts}
```

Classic "staging note that never got removed before deploy" pattern.

## Bonus lead for later

`app.js` also revealed a real backend route referenced by the front end:

```js
const API = "/api/guest";
```

Given the room's later narrative (hidden rooms, guest profiles built from "breakfasts and a livestream"), this endpoint is likely relevant to the next stage.

## Takeaways

- A clean gobuster run with a small/no-extension wordlist doesn't mean nothing's there — check status-code filtering and try a bigger wordlist with extensions before ruling a target out.
- Always check for exposed version control (`/.git/HEAD`, `/.svn/`, etc.) directly with curl — these live outside anything a directory wordlist would guess, and "shipped in a hurry" is a strong hint to check.
- `git-dumper` beats manual `wget --mirror` for reconstructing a leaked repo — it walks the actual object graph instead of hoping directory listing works.
- Check README/config files first in a small dumped repo — staging notes and "remove before launch" comments are a very common place for CTF flags and real-world secrets alike.