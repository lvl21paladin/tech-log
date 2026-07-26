---
title: "Group Managed Service Accounts (gMSAs)"
date: 2024-01-09T22:27:40+01:00
tags: ["Active Directory", "gMSA", "PowerShell"]
excerpt: "Setting up Group Managed Service Accounts in Active Directory: the KDS root key, naming conventions, PowerShell setup, and scheduling tasks with a gMSA."
---

## Introduction

Group managed service accounts (gMSAs) are domain accounts to help secure services. gMSAs can run on one server, or in a server farm, such as systems behind a network load balancing or Internet Information Services (IIS) server. After you configure your services to use a gMSA principal, account password management is handled by the Windows operating system (OS).

## KDS Root Key

Create the KDS Root Key - This is used by the KDS service on DCs (along with other information) to generate passwords. It is required only once per forest.

```powershell
Add-KDSRootKey -EffectiveImmediately
```

*You have to wait up to 10 hours. This is a safety measure to make sure all DCs have replicated and are able to respond to gMSA requests*

You can bypass this if you are setting up in a test environment. This is **NOT** recommended in prod enviroment.

```powershell
Add-KdsRootKey –EffectiveTime ((get-date).addhours(-10))
```

## Naming Convention

Naming conventions for gMSAs (Group Managed Service Accounts) are essential for maintaining a clear and organized Active Directory environment. Here are some guidelines and suggestions for naming gMSAs:

*Descriptive and Clear:*

* Choose names that clearly describe the purpose or function of the service that the gMSA is associated with. This helps administrators understand the account's role at a glance.

*Consistent Formatting:*

* Establish a consistent naming format to make it easier for administrators to identify and manage gMSAs. This could include prefixes or suffixes to denote the type of account.

*Include Environment or Location Information:*

* If applicable, consider including environment or location information in the gMSA name. This is particularly useful in larger organizations with multiple environments (e.g., production, testing) or distributed locations.

*Here's an example following these guidelines:*

```
Prefix: gMSA_
ServiceDescription: WebApp_
Environment: Prod_

ex. gMSA_WebApp_Prod
```

## Setup

*Creating and Managing gMSAs in Active Directory Using PowerShell*

1. Open PowerShell with Administrative Privileges

2. Import the Active Directory Module

```powershell
Import-Module ActiveDirectory
```

3. Create a security group in Active Directory

```powershell
New-ADGroup -Name <Security_Group_Name> -GroupScope Global -GroupCategory Security
```

4. Create a new gMSA

```powershell
New-ADServiceAccount -Name <gMSA_Name> -DNSHostName <DNS_Name> -PrincipalsAllowedToRetrieveManagedPassword <Security_Group>
```

5. Fetch details of the newly created gMSA

```powershell
Get-ADServiceAccount -Identity <gMSA_Name>
```

6. Install the gMSA on the server where the service or task will run

```powershell
Install-ADServiceAccount -Identity <gMSA_Name>
```

7. Confirm the gMSA is installed successfully

```powershell
Test-ADServiceAccount -Identity <gMSA_Name>
```

8. Grant necessary permissions to the service account as required

## Create Task Scheduler via PowerShell

Creating Group Managed Service Accounts (gMSAs) for Task Scheduler through the graphical user interface (GUI) is not supported. gMSAs are primarily designed for scenarios where services and applications need to run on servers without requiring human intervention for password management.

```powershell
# Specify the task action
$action = New-ScheduledTaskAction -Execute "PowerShell.exe" -Argument "C:\scripts\test.ps1"

# Specify the trigger (e.g., daily at 2:00 AM)
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM

# Specify the user account (replace 'YourDomain\YourgMSA' with your actual gMSA)
$user = "Domain\<gMSA-name>$"
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Password 

# Register the scheduled task
Register-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -TaskName "<name>" -Description "<description>"
```

If you need to make changes to the user account for a service that is configured with a gMSA, you cannot do this via the UI before running the command bellow in CMD.

```cmd
sc managedaccount <serviceName> false.
```
