---
title: "TryHackMe - Byte Lotus: Complimentary"
date: 2026-07-30
tags: ["TryHackMe", "AWS Security", "Cloud Security", "Cognito", "IAM Misconfiguration"]
excerpt: "A 'free' wellness app with no login screen still has to decide what you're allowed to see. Tracing that decision back to an AWS Cognito Identity Pool, and finding out its guest role could read every guest's data, not just yours."
---

## TL;DR

Byte Lotus Wellness is a no-login "guest dashboard" that quietly hands every visitor temporary AWS credentials through a Cognito Identity Pool, then uses them to read a DynamoDB table client-side. The app only ever calls `GetItem` for your own guest ID, but nothing stops the same guest credentials from calling `Scan` on the whole table. The IAM policy attached to the *unauthenticated* Cognito role was scoped to the table, but not to the action or the row — so anyone could dump every guest's name, email, phone, GPS coordinates, and plaintext password with a single API call.

## The pitch

No account. No login screen. Free access in exchange for camera, mic, contacts, and location — the kind of app that "just knows things about you" the moment you open it. That framing is the whole hint: something is still deciding what you're allowed to see, even without a sign-in step. If there's no login, that gatekeeping has to live somewhere else.

## Recon: reading app.js

The site's client-side JavaScript gave up the architecture immediately:

```js
const IDENTITY_POOL_ID = "us-east-1:836c0949-292d-485b-b532-52d5ca7bb688";
const AWS_REGION = "us-east-1";
const TABLE_NAME = "complimentary-GuestWellnessProfiles";

AWS.config.credentials = new AWS.CognitoIdentityCredentials({
  IdentityPoolId: IDENTITY_POOL_ID,
});
```

No login screen, because there's no server-side auth at all. Instead:

- Every visitor gets a random `guest-xxxxxxxx` ID stashed in `localStorage`.
- The browser exchanges the Cognito Identity Pool ID for **temporary, unauthenticated AWS credentials**.
- Those credentials are used directly from the browser to call `dynamodb.getItem()` against a table named `complimentary-GuestWellnessProfiles`, keyed on `guest_id`.

This is a legitimate, supported AWS pattern — Cognito Identity Pools can absolutely hand out scoped-down guest credentials so a static site can talk to AWS services without a backend. The security of the whole app therefore comes down to one thing: how tightly is the IAM role attached to that unauthenticated identity actually scoped?

The app's own code only ever asks for `GetItem` on one row. That tells you what the *app* does. It tells you nothing about what the *credentials* allow.

## Getting the same guest credentials myself

Cognito's unauthenticated flow is two public, unsigned API calls — no account, no login, no API key. Anyone can do exactly what the app does:

```bash
# 1. Get a guest identity
aws cognito-identity get-id \
  --identity-pool-id us-east-1:836c0949-292d-485b-b532-52d5ca7bb688 \
  --region us-east-1 --no-sign-request

# 2. Exchange it for temporary AWS credentials
aws cognito-identity get-credentials-for-identity \
  --identity-id <IDENTITY_ID_FROM_STEP_1> \
  --region us-east-1 --no-sign-request
```

That returns a real, time-limited `AccessKeyId` / `SecretKey` / `SessionToken` — the exact same credentials the app itself would have received. From here it's just a matter of testing what they're actually good for, rather than assuming they're limited to what the frontend calls.

## Testing the boundary

With the guest credentials loaded, I checked who I really was, and then poked at what else the role would allow beyond the single `GetItem` the app makes:

```python
sts.get_caller_identity()
# arn:aws:sts::332173347248:assumed-role/complimentary-cognito-unauth-role/CognitoIdentityCredentials

dynamodb.list_tables()
# AccessDeniedException — not authorized for dynamodb:ListTables

dynamodb.scan(TableName="complimentary-GuestWellnessProfiles")
# 200 OK — five items returned

dynamodb.describe_table(TableName="complimentary-GuestWellnessProfiles")
# AccessDeniedException — not authorized for dynamodb:DescribeTable

s3.list_buckets()
# AccessDenied — not authorized for s3:ListAllMyBuckets
```

So the role is reasonably contained — no cross-service reach, no table enumeration, no schema access. But `dynamodb:Scan` on the one table it *does* know about was allowed, and that was enough. A `Scan` doesn't care whose row it's returning; it returns all of them.

## The result

The scan dumped every guest profile in the table, not just the one belonging to my own `guest-xxxxxxxx` ID — full names, emails, phone numbers, GPS coordinates, and plaintext passwords for guests who never signed up for anything, plus a note planted specifically for whoever went looking:

```
"notes": "If you're reading this, the wellness app's guest role
can read every profile, not just its own. THM{xxxxxxx}"
```


## Root cause

The vulnerability isn't in the app's JavaScript — the frontend code is exactly as innocuous as it looks. It's in the IAM policy attached to the Cognito Identity Pool's *unauthenticated* role. That policy granted `dynamodb:Scan` (or an action wildcard covering it) on the table's full ARN, with no row-level restriction. Since Cognito Identity Pools tie each guest to a stable `IdentityId`, the fix is well-supported and standard:

- Only allow `dynamodb:GetItem` (and `PutItem`/`UpdateItem` if writes are needed) — never `Scan` or `Query` without a key condition, for an unauthenticated role.
- Add a `dynamodb:LeadingKeys` condition scoped to `${cognito-identity.amazonaws.com:sub}`, so each identity can only ever touch the row matching its own identity — not anyone else's, and not the whole table.

Something along these lines:

```json
{
  "Effect": "Allow",
  "Action": "dynamodb:GetItem",
  "Resource": "arn:aws:dynamodb:us-east-1:ACCOUNT_ID:table/complimentary-GuestWellnessProfiles",
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["${cognito-identity.amazonaws.com:sub}"]
    }
  }
}
```

Without that condition, "no login needed" quietly becomes "no authorization needed either" — the app's restraint in what it *asks for* was doing all the work that the IAM policy should have been doing instead.

## Takeaways

"No account needed" is a UX decision, not a security boundary. Somewhere, something is still deciding what a given caller can see — if that isn't a login and a per-user policy, it's worth finding out what it actually is before trusting a "free" app with camera, mic, contacts, and location. In this case that something was an AWS IAM role, and it was checking the table name but not the row.

The other lesson is for anyone shipping this pattern: client-side AWS SDK code is fully inspectable and its credentials are fully reproducible by anyone with the identity pool ID. The frontend's own restraint (only ever calling `GetItem`) is not a control. The IAM policy is the only real control, and it has to be scoped as if the frontend code didn't exist at all.