---
title: "Securing Local Administrator Passwords with LAPS"
date: 2024-01-05T22:03:12+01:00
tags: ["LAPS", "Active Directory", "PowerShell"]
excerpt: "Installing and configuring Microsoft's Local Administrator Password Solution: schema extension, OU delegation, group policy, and verification."
---

# How to Install and Configure Local Administrator Password Solution (LAPS)

## Introduction

In this blog post, we'll discuss how to install and configure Microsoft's Local Administrator Password Solution (LAPS). LAPS provides a centralized way of managing local administrator passwords on domain-joined computers, enhancing security within an Active Directory environment.

## Prerequisites

- Active Directory Domain Services
- Domain Admin permissions
- PowerShell

## Step 1: Download and Install LAPS

First, download LAPS from the Microsoft website. Then, install LAPS on a management computer and the AD schema master. Use the following PowerShell commands for installation:

```powershell
# Download LAPS
Invoke-WebRequest -Uri "https://download.microsoft.com/download/LAPS/LAPS.x64.msi" -OutFile "LAPS.x64.msi"
```

```powershell
# Install LAPS
Start-Process -FilePath "msiexec.exe" -ArgumentList "/i LAPS.x64.msi /quiet" -Wait
```

## Step 2: Install the AdmPwd.PS Module

Before extending the AD schema, ensure that the AdmPwd.PS PowerShell module is installed. This module is required to manage the LAPS settings. Install it using the following command:

```powershell
Install-Module -Name AdmPwd.PS -Force
```

## Step 3: Extend the AD Schema

To store the passwords and settings, extend the AD schema using the LAPS PowerShell module:

```powershell
Import-Module AdmPwd.PS
Update-AdmPwdADSchema
```

## Step 4: Delegate Permissions

Delegate permissions to the required Organizational Units (OUs) for computer objects. This allows LAPS to update passwords and store them in AD.

```powershell
# Replace 'OU=Computers,DC=example,DC=com' with your specific OU
Set-AdmPwdComputerSelfPermission -OrgUnit "OU=Computers,DC=example,DC=com"
```

## Step 5: Configure Group Policy

Create a new GPO or use an existing one to configure LAPS settings. These settings include password policy settings and the enabling of LAPS.

## Step 6: Install LAPS on Client Computers

Install the LAPS client on all domain-joined computers. You can use GPO or scripts to automate this process.

## Step 7: Verify LAPS Operation

After installation, verify that LAPS is working correctly. You can use PowerShell to check the local admin password of a computer:

```powershell
# Replace 'OU=Computers,DC=example,DC=com' with your specific OU
Get-AdmPwdPassword -ComputerName "ComputerName"
```

## Conclusion

LAPS is an essential tool for managing local administrator passwords in a Windows domain environment. By following these steps, you can enhance the security of your network.
