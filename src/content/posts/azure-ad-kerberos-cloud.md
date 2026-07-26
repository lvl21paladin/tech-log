---
title: "Enabling Azure AD Kerberos for Cloud"
date: 2024-05-15T20:07:31+02:00
tags: ["Azure AD", "Kerberos", "Windows Hello for Business"]
excerpt: "Configuring Azure AD Kerberos for hybrid cloud trust: installing the PowerShell module, creating the Kerberos server object, and verifying it."
---

## Enabling Azure AD Kerberos for Cloud

Setting up Azure AD Kerberos is incredibly easy.
When you enable Azure AD Kerberos, it creates a unique server object within your domain.

- Resembles a Read-Only Domain Controller (RODC) but isn't tied to any physical server.
- Is utilized by Azure AD to generate partial Ticket Granting Tickets (TGTs) for your Active Directory domain. It adheres to the same rules and limitations as RODCs.

In this guide, we'll walk through configuring Azure AD Kerberos.
Prereqs can be found [here](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/deploy/hybrid-cloud-kerberos-trust?WT.mc_id=ES-MVP-5004117&tabs=intune#prerequisites)

First, install the necessary PowerShell module:

```powershell
Install-Module -Name AzureADHybridAuthenticationManagement -AllowClobber
```

Second, create the Kerberos server object:

```powershell
# Specify the on-premises Active Directory domain. A new Azure AD
# Kerberos Server object will be created in this Active Directory domain.
$domain = $env:USERDNSDOMAIN

# Enter a UPN of an Azure Active Directory global administrator
$userPrincipalName = "administrator@contoso.onmicrosoft.com"

# Enter a domain administrator username and password.
$domainCred = Get-Credential

# Create the new Azure AD Kerberos Server object in Active Directory
# and then publish it to Azure Active Directory.
# Open an interactive sign-in prompt with given username to access the Azure AD.
Set-AzureADKerberosServer -Domain $domain -UserPrincipalName $userPrincipalName -DomainCredential $domainCred

```

Verify that the Kerberos server object was created:

```powershell
Get-AzureADKerberosServer -Domain $domain -UserPrincipalName $userPrincipalName
```

third, configure intune policy
