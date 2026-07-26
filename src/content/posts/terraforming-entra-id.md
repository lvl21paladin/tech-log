---
title: "Terraforming Entra ID: Groups, Users and Applications"
date: 2024-04-12T19:40:44+02:00
tags: ["Terraform", "Entra ID", "Azure DevOps"]
excerpt: "Automating Entra ID groups, user memberships, and enterprise app role assignments with Terraform and an Azure DevOps pipeline."
---

##### Create groups and assignments with terraform

In our tenant, we manage an enterprise application that provides access to various apps and servers within our environment. To adhere to zero-trust principles, it's essential to implement a least privilege model. Permissions are configured through groups in Entra ID, necessitating the creation of numerous groups to accommodate different permission levels. Manually managing this process is impractical, making Infrastructure as Code (IaC) the optimal solution. Specifically, we rely on Terraform to automate the creation and management of these groups.

To streamline our IaC deployments, we use Azure DevOps and its pipelines. In this example, we'll demonstrate how to create Entra ID groups, assign existing members to these groups, and then assign the groups to an enterprise application, all through Azure DevOps pipelines.

##### Azure DevOps

In the existing repository, we'll set up variable a group. This group are used to securely store credentials for the service principal that runs the pipeline.
In your repository, navigate to Pipeline and click on Library to set up a Variable Group. In this group, add the Client ID, Client Secret, Subscription ID, and Tenant ID for the service principal.

##### Permissions

We need to grant the service principal permissions to create entra-id group and permissions for assigning groups and app roles to applications.
On your service principal, navigate to the API Permissions tab and add the following permissions;

- AppRoleAssignment.ReadWrite.All
- Directory.Read.All
- Group.ReadWrite.All

Next, we need to obtain the Object ID and App Role ID for the Enterprise application to which we want to assign the groups. In this case, the Enterprise application was created outside of Terraform, so we need to locate it and reference it in our code.

Navigate to the Enterprise application and take not of the Object ID and the App role ID.
App role ID is located on the Enterprise application under the manage blade.
We need the IDs in our code that is coming up next.

##### Terraform

Let's set up the code. We use a flat structure and organize the code into separate files for different parts to keep it simple and readable.
First, lets setup a storage for remote state. We will use a Azure storage account.

backend.tf

```terraform
  # Configure the Terraform settings and backend
  terraform {
  backend "azurerm" {
    resource_group_name  = "rg-name"  # Name of the resource group containing the storage account
    storage_account_name = "st-name"         # Name of the storage account
    container_name       = "tfstate-name"             # Name of the container to store the state file
    key                  = "path" # Path to the state file within the container
  }
}
```

Next we add the group part.

groups.tf

```terraform
# Create Azure AD groups
resource "azuread_group" "aad_groups" {
  # Iterate over the groups defined in the variable and create a map with group names as keys

  for_each = { for group in var.groups : group.name => group }
  display_name     = each.value.name       # Set the display name of the group
  mail_enabled     = false                 # Disable mail functionality for the group
  security_enabled = true                  # Enable security functionality for the group
  description      = each.value.description # Set the description of the group
}
```

Setup outputs for groups.

outputs.tf

```terraform
# Output the IDs of the created groups
output "aad_group_ids" {
  value = { for group in azuread_group.aad_groups : group.display_name => group.id }
}
 
# Output the details of the created groups
output "aad_group_details" {
  value = { 
    for group in azuread_group.aad_groups : 
    group.display_name => {
      description = group.description
    } 
  }
}
```

We need providers.

providers.tf

```terraform
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~>3.0"
}

provider "azuread" {
  tenant_id = var.tenant_id  # Azure AD tenant ID provided via a variable
}
```

Lets add the role assignment part.

role_assignment.tf

```terraform
# Assign an Azure AD application role to groups
resource "azuread_app_role_assignment" "aad_group" {
  for_each = azuread_group.aad_groups

  principal_object_id = each.value.id     # The object ID of the group to which the role will be assigned
  app_role_id         = "<ROLE ID>" # The ID of the application role msiam_access under App role blade in Entra ID
  resource_object_id  = var.enterprise_app_object_id # The object ID of the enterprise application

}
```

users.tf

```terraform
# Define local values
locals {
  # Flatten the user group memberships into a list of maps with user principal name and group name
  user_group_memberships_flat = flatten([
    for upn, groups in var.user_group_memberships : [
      for group in groups : {
        user_principal_name = upn
        group_name = group
      }
    ]
  ])
}
  
# Create Azure AD group memberships
resource "azuread_group_member" "aad_group_memberships" {
  # Iterate over the flattened list of user group memberships
  for_each = {
    for item in local.user_group_memberships_flat :
    "${item.user_principal_name}-${item.group_name}" => item
  } 

  group_object_id  = azuread_group.aad_groups[each.value.group_name].id # The object ID of the group
  member_object_id = var.existing_users[each.value.user_principal_name] # The object ID of the user
}
```

variables.tf

```terraform
# Variable for the list of AAD groups to create
variable "groups" {
  description = "List of AAD groups to create"
  type        = list(object({
    name        = string       # The name of the group
    description = string       # The description of the group
  }))
}  

# Variable for the tenant ID for Azure AD
variable "tenant_id" {
  description = "The tenant ID for the Azure AD"
  type        = string         # The tenant ID as a string
}

# Variable for the map of existing user principal names to their object IDs
variable "existing_users" {
  description = "Map of existing user principal names to their object IDs"
  type        = map(string)    # A map where keys are user principal names and values are object IDs
} 

# Variable for the map of user principal names to a list of group names they should be members of
variable "user_group_memberships" {
  description = "Map of user principal names to a list of group names they should be members of"
  type        = map(list(string)) # A map where keys are user principal names and values are lists of group names
}

# Variable for the Object ID of the enterprise application
variable "enterprise_app_object_id" {
  description = "The Object ID of the enterprise application"
  type        = string         # The Object ID as a string
}
```

Next, we define the groups in the `tfvars` file:

```terraform
groups = [
      # RDP GROUPS
  {
    name        = "app1-xx-rdp-server1"
    description = "access to rdp on server1"
  },
    {
    name        = "app2-xx-rdp-server2"
    description = "access to rdp on server2"
]
  }

existing_users = {
  "user1@domain.com" = "<ObjectID>"
  "user2@domain.com" = "<ObjectID>"
}

user_group_memberships = {
  "user1@domain.com" = [
    "app2-xx-rdp-server2"
  ]

  "user2@domain.com" =[
    "app2-xx-rdp-server2",
    "app2-xx-rdp-server1"
]
}

enterprise_app_object_id = "<Object ID of enterprise app>" # App Object ID 
tenant_id = "<tenantID>"  # Tenant ID
```

##### Azure DevOps Pipeline

Now that our code is ready and the remote state is set up, let's proceed to configure the pipeline in Azure DevOps.
In Azure DevOps we also setup 'Environments' for 'Prod'

Pipeline templates:

```yaml
name: Deploy groups and membership to entra-id 
trigger:
  branches:
    include:
      - main
variables:
  - group: <variable group name>
  - name: rootFolder
    value: 'rootfolder/'
  - name: tfvarsFile
    value: 'terraform.tfvars'
  - name: adoEnvironment
    value: 'prod'
stages:
- template: template/azure-pipeline.yaml
  parameters:
    rootFolder: $(rootFolder)
    tfvarsFile: $(tfvarsFile)
    adoEnvironment: $(adoEnvironment)
```

azure-pipeline.yaml

```yaml
parameters:
- name: rootFolder
  type: string
- name: tfvarsFile
  type: string
- name: adoEnvironment
  type: string
  
stages:
- stage: 'Terraform_Plan'
  displayName: 'Terraform Plan'
  jobs:
  - job: 'Terraform_Plan'
    pool:
      vmImage: 'ubuntu-latest'
    steps:
    - script: |
        echo "Running Terraform init..."
        terraform init
        echo "Running Terraform plan..."
        terraform plan -var-file ${{ parameters.tfvarsFile }}
      displayName: 'Terraform plan'
      workingDirectory: ${{ parameters.rootFolder }}
      env:
        ARM_CLIENT_SECRET: $(ARM_CLIENT_SECRET) # this needs to be explicitly set as it's a sensitive value
- stage: 'Terraform_Apply'
  displayName: 'Terraform Apply'
  dependsOn:
  - 'Terraform_Plan'
  condition: succeeded()
  jobs:
  - deployment: 'Terraform_Apply'
    pool:
      vmImage: 'ubuntu-latest'
    environment: ${{ parameters.adoEnvironment }} # using an ADO environment allows us to add a manual approval check
    strategy:
      runOnce:
        deploy:
          steps:
          - checkout: self
          - script: |
              echo "Running Terraform init..."
              terraform init
              echo "Running Terraform apply..."
              terraform apply -var-file ${{ parameters.tfvarsFile }} -auto-approve
            displayName: 'Terraform apply'
            workingDirectory: ${{ parameters.rootFolder }}
            env:
              ARM_CLIENT_SECRET: $(ARM_CLIENT_SECRET) # this needs to be explicitly set as it's a sensitive value
```
