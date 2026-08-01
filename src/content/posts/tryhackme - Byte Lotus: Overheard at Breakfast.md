---
title: "TryHackMe - Byte Lotus: Overheard at Breakfast"
date: 2026-08-01
tags: ["TryHackMe", "OSINT", "Gravatar", "Social Engineering"]
excerpt: "A screenshotted chat between two hotel guests hands over an email address, which is all it takes to unmask a 'wiped' Gravatar profile via its hash-based lookup."
---

# TryHackMe: Byte Lotus — Overheard at Breakfast

**Room theme:** A guest at the Byte Lotus breakfast terrace overhears and screenshots a conversation between two other guests, "Ponzi - Influencer" and "Lambo!", before the table's occupant returns. Somewhere in that exchange is enough to track down an account nobody was supposed to find.

**Task itinerary:**
- Analyze the provided conversation for identifying details.
- Extract the relevant clues.
- Locate the hidden account.
- Submit the flag.

## The conversation

The screenshot shows a Discord-style DM. Ponzi asks Lambo for a way to be tagged in future posts. Lambo replies that he doesn't use social media much anymore, but mentions:

> "I used to use this free tool that let me upload my profile and link other media accounts, was neat, until I wiped everything. Started with a **G** if I remember correctly."

He then drops his contact address directly in the chat:

```
lambobytelotushotel@gmail.com
```

Two clues, deliberately placed together: a service name starting with "G," and an email address.

## Identifying the tool

A free profile tool that lets you link other social accounts, whose name starts with "G," and which is tied to an email address — that's **Gravatar**. Gravatar profiles are looked up not by username but by a hash of the account's email address, which is the whole point of the clue: Lambo believes he "wiped everything," but the profile is still reachable by anyone who can compute the hash — no login or search required.

## Hashing the email

Gravatar profile URLs use an MD5 (legacy) or SHA256 (current) hash of the trimmed, lowercased email address:

```bash
echo -n "lambobytelotushotel@gmail.com" | tr '[:upper:]' '[:lower:]' | md5sum
# d4a5fc5d3128890778667e24617d7cc0

echo -n "lambobytelotushotel@gmail.com" | sha256sum
# d43faafe9d7f056793bd037b8d6e321acad985c222d83775b10d6539e301e931
```

## Finding the profile

Visiting the hash-based Gravatar URL resolves straight to a live, populated profile — despite Lambo's claim of having wiped it:

```
https://en.gravatar.com/d4a5fc5d3128890778667e24617d7cc0
→ https://gravatar.com/cheerfullysongf28e3c3716
```

The profile's bio field contained a message clearly aimed at whoever solved the puzzle:

> "Funny thing about email hashes, they follow you places you didn't expect. Glad you found the right corner of the internet! Here is your prize: `VEhNe1MzY3JlVF9QcjBmaWwzX0g0c19iMzNuX0lkZW50MWZpM2R9`"

## Decoding the flag

The prize string is base64:

```bash
echo "VEhNe1MzY3JlVF9QcjBmaWwzX0g0c19iMzNuX0lkZW50MWZpM2R9" | base64 -d
```

```
THM{xxxx}
```

## Takeaways

- Gravatar (and similar hash-keyed profile services) can't really be "deleted" from casual discovery the way a username-based profile can — anyone who has your email can compute the same hash and find the page, even years later.
- Innocuous-seeming details dropped in casual conversation — "a tool that starts with G," an email shared for convenience — are exactly the kind of breadcrumbs OSINT investigations are built on. Neither detail alone is much; together they're a direct path to an account.
- Sharing an email address casually (even in a "private" DM screenshot) links every service tied to that address, deleted profile or not, unless the address itself is rotated.