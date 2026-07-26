---
title: "Automating Secure File Transfers with Azure, PowerShell, and WinSCP"
date: 2024-02-04T20:34:10+01:00
tags: ["Azure", "PowerShell", "WinSCP"]
excerpt: "Pulling credentials from Azure Key Vault to automate secure SFTP transfers with WinSCP, then sorting downloaded files across network shares."
---

# Automating Secure File Transfers with Azure, PowerShell, and WinSCP

## Introduction

Managing file transfers securely and not losing sleep over it? Yes, please! We're diving into a cool setup using Azure Key Vault, PowerShell, and WinSCP to make secure file transfers a breeze. Azure Key Vault keeps our secrets safe, PowerShell lets us automate the boring stuff, and WinSCP handles the heavy lifting of file transfers. This post is all about setting up a system that pulls credentials safely, connects to an SFTP server, and moves files around without breaking a sweat. Perfect for sysadmins, devs, or anyone looking to up their security game with some automation magic. Let's get started!

## Objectives

- Script runs in Task Scheduler
- Run as gMSA service account
- Retrieve a secret from Azure Key Vault using PowerShell.
- Use the secret to authenticate and connect to an external SFTP server with WinSCP.
- Download all files from the SFTP server and securely delete them post-download.
- Distribute the downloaded files across different network shares based on file types.

## Prerequisites

- Azure account with access to a Key Vault.
- PowerShell and Azure PowerShell module.
- WinSCP and its .NET library installed on the local machine.
- SFTP server details and access credentials stored in Azure Key Vault.

## Authentication with Azure

To authenticate with Azure, you'll first need to set up a service principal. This involves creating an app registration in Azure AD and configuring it for certificate-based authentication. You can use self-signed certificate for this task.
Remember: The service principal need read permssions to the azure keyvault where the secret lives.

## Script

My script scans for new files on an external SFTP server. If it finds any, it downloads them to a designated download folder on my server, then removes them from the SFTP server. Next, the script moves the files to a backup folder. It also sorts the files, copying .pdf files to one network location and .inv files to another. Once the copying is finished, the script clears the files from the local download folder. I am running this as under a gMSA account with Task Scheduler.

## Certificate

The self-signed certificate must be installed on the server where this script will execute.
Self-signed certs can be generated via powershell.

```powershell
$subjectName = "OnPremToAzure"
$certStore = "LocalMachine"
$validityPeriod = 24

$newCert = @{
    Subject = "CN=$($subjectName)"
    CertStoreLocation = "Cert:\$($certStore)\My"
    KeyExportPolicy = "Exportable"
    KeySpec = "Signature"
    NotAfter = (Get-Date).AddMonths($($validityPeriod))
}
New-SelfSignedCertificate @newCert
```

After the certificate is created we need to export it so we can upload it to our new Azure App registration (service principal)

```powershell
$certFolder = "C:\temp\certs"
$certExport = @{
    Cert     = $Cert
    FilePath = "$($certFolder)\$($subjectName).cer"
}
Export-Certificate @certExport
```

## Installing WinSCP on computer

WinSCP and its .NET library installed on the local machine
Refrence the path to .dll file in the script

```powershell
Add-Type -Path "C:\Program Files (x86)\WinSCP\WinSCPnet.dll"
```

## Logging Functionality

Logging is great. I am just adding a basic log function in my script so i kan keep track.

```powershell
function Write-Log {
    Param (
        [string]$Message
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$($timestamp): $Message" | Out-File -FilePath $logFilePath -Append
}
```

`Ensure the gMSA account has read permissions for the self-signed certificate on the local computer`

## Code

```powershell
# Define your parameters
$tenantId = "TenantId"
$keyVaultName = "kv-name"
$secretName = "secretname"
$certThumbprint = "CertThumPrint"
$appId = "AppID"

# Define log file path
$logFilePath = "E:\LogPath\LogFile.log"

# Function to write log
function Write-Log {
    Param (
        [string]$Message
    )
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$($timestamp): $Message" | Out-File -FilePath $logFilePath -Append
}

# Write initial log
Write-Log "Script started. Running as user: $env:USERNAME"

# Authenticate with Azure using the Certificate
#$cert = Get-Item -Path "Cert:\LocalMachine\My\$certThumbprint"
Connect-AzAccount -ServicePrincipal -Tenant $tenantId -ApplicationId $appId -CertificateThumbprint $certThumbprint

Write-Log "Connected to Azure Account."

# Retrieve the secret from Azure Key Vault
$secret = Get-AzKeyVaultSecret -VaultName $keyVaultName -Name $secretName

Write-Log "Secret retrieved from Azure Key Vault."

# Convert the SecureString to Plain Text
$ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret.SecretValue)
try {
    $secretValue = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

Write-Log "Secret converted to plain text."

# Load WinSCP .NET assembly
Add-Type -Path "C:\Program Files (x86)\WinSCP\WinSCPnet.dll"

Write-Log "WinSCP .NET assembly loaded."

# Set up session options with the password from Azure Key Vault
$sessionOptions = New-Object WinSCP.SessionOptions -Property @{
    Protocol = [WinSCP.Protocol]::Sftp
    HostName = "xx.xx.xx.com"
    UserName = "Username"
    Password = $secretValue
    SshHostKeyFingerprint = "ssh-rsa 2048 xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx:xx"
}

$session = New-Object WinSCP.Session

try {
    # Connect
    $session.Open($sessionOptions)
    Write-Log "Connected to SFTP server."

    # Check if there are files to download
    $remotePath = "/download"
    $filesToDownload = $session.ListDirectory($remotePath).Files | Where-Object { -not $_.IsDirectory }

    if ($filesToDownload.Count -eq 0) {
        Write-Log "No files to download from SFTP server."
        return
    } else {
        Write-Log "Found $($filesToDownload.Count) files to download."
    }

    # Download files to the local directory, adjust the paths as necessary
    $localPath = "E:\folder\download\"
    $session.GetFiles($remotePath + "/*", $localPath).Check()
    Write-Log "Files downloaded to $localPath."

    # Delete files after download
    $files = $session.ListDirectory($remotePath).Files
    foreach ($file in $files) {
        if (!$file.IsDirectory) {
            $session.RemoveFiles($session.EscapeFileMask($remotePath + "/" + $file.Name)).Check()
            Write-Log "Deleted file: $($file.Name)"
        }
    }
}
catch {
    Write-Log "Error: $_"
}
finally {
    # Disconnect, clean up
    $session.Dispose()
    Write-Log "Session disposed."
}

Write-Log "Files downloaded and deleted from SFTP server."

# Define the source and destination directories
$sourceDir = "E:\source\download"
$destDir = "E:\destination\backup"

# Check if the source directory exists
if (Test-Path -Path $sourceDir) {
    # Check if the destination directory exists, if not, create it
    if (-not (Test-Path -Path $destDir)) {
        New-Item -ItemType Directory -Force -Path $destDir
    }

    # Copy all files from source to destination
    Copy-Item -Path "$sourceDir\*" -Destination $destDir -Recurse -Force
    Write-Log "All files have been copied from $sourceDir to $destDir."
} else {
    Write-Log "The source directory $sourceDir does not exist."
}

# Copy from Local server to Network server
# Define destination directories for each file type
$destDirPdf = "\\Networkshare1\"
$destDirInv = "\\Networkshare2\"

# Check if all .pdf and .inv files are copied successfully
# Initialize a variable to track copy success
$allFilesCopiedSuccessfully = $true

# Function to copy and verify files
function Copy-And-Verify {
    param(
        [string]$sourceFile,
        [string]$destinationDir
    )
    $destinationFilePath = Join-Path -Path $destinationDir -ChildPath (Split-Path $sourceFile -Leaf)
    
    # Ensure the destination directory exists
    if (-not (Test-Path -Path $destinationDir)) {
        New-Item -ItemType Directory -Force -Path $destinationDir
    }
    
    # Copy the file
    Copy-Item -Path $sourceFile -Destination $destinationFilePath -Force
    
    # Verify the file was copied
    if (-not (Test-Path -Path $destinationFilePath)) {
        Write-Host "Failed to copy file: $sourceFile"
        return $false
    }
    return $true
}

# Copy .pdf files and check for success
$pdfFiles = Get-ChildItem -Path $sourceDir -Filter "*.pdf"
foreach ($file in $pdfFiles) {
    $result = Copy-And-Verify -sourceFile $file.FullName -destinationDir $destDirPdf
    if (-not $result) { $allFilesCopiedSuccessfully = $false }
}

# Copy .inv files and check for success
$invFiles = Get-ChildItem -Path $sourceDir -Filter "*.inv"
foreach ($file in $invFiles) {
    $result = Copy-And-Verify -sourceFile $file.FullName -destinationDir $destDirInv
    if (-not $result) { $allFilesCopiedSuccessfully = $false }
}

Write-Log "All .pdf files have been copied to $destDirPdf."
Write-Log "All .inv files have been copied to $destDirInv."

# If all files are copied successfully, delete the contents of the source folder
if ($allFilesCopiedSuccessfully) {
    Get-ChildItem -Path $sourceDir | Remove-Item -Force
    Write-Log "All files have been successfully copied and the source directory contents have been cleared."
} else {
    Write-Log "Some files may not have been copied successfully. The download directory contents will not be cleared."
}

```
