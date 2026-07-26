---
title: "Streamlining Homelab Deployments with GitOps: A Chores App Case Study"
date: 2026-07-24
tags: ["K3s", "ArgoCD", "GitOps"]
excerpt: "Containerizing and deploying a custom Chores app to refine a GitOps workflow using K3s and ArgoCD."
---

In my recent projects, I've been focused on automating my homelab environment, moving away from manual configuration toward a robust, "everything-as-code" approach. My latest project—containerizing and deploying a custom Chores application—offered a perfect opportunity to refine this GitOps workflow using K3s and ArgoCD.

## The Tech Stack

- **Orchestration:** K3s (lightweight Kubernetes)
- **Deployment Pattern:** GitOps (App-of-Apps via ArgoCD)
- **CI/CD:** GitHub Actions (Automated image builds)
- **Routing & Security:** Traefik Ingress + Cloudflare Tunnel
- **Infrastructure:** GHCR (GitHub Container Registry)

## The Challenge: From Dockerfile to Cluster

The goal was simple: take an existing application and make it part of my automated infrastructure. However, moving from a local Dockerfile to a scalable, GitOps-managed service requires more than just building an image. It requires a repeatable pipeline.

## The Solution: An End-to-End Pipeline

![GitOps deployment pipeline for the Chores app](/tech-log/gitops-flow.svg)

I structured the project around three distinct layers of automation:

1. **CI/CD Pipeline (GitHub Actions):** Whenever I push code to the `chores-app` repository, a GitHub Action automatically triggers. It builds the Docker image and pushes it to the GitHub Container Registry (GHCR) with a fresh version tag.
2. **Infrastructure as Code (GitOps):** In my primary `lazylab-gitops` repository, I define the state of my cluster. Using an App-of-Apps pattern, I configured the Chores app to be picked up by ArgoCD.
3. **Deployment & Routing:** ArgoCD monitors the Git repo. As soon as a new image tag is detected, it reconciles the cluster state. I used Traefik to manage local routing and a Cloudflare Tunnel (`cloudflared`) to ensure that sensitive paths—like administrative dashboards—remain secure and accessible only through my Zero Trust policy.

## Why This Matters

For recruiters and developers, this setup demonstrates a few core competencies:

- **Version Control:** The entire infrastructure is defined in Git, meaning I can roll back to any previous version of my homelab instantly.
- **Automation:** By offloading build and deployment tasks to CI/CD pipelines, I eliminate "human error" in deployment steps.
- **Security-First Design:** By combining Traefik for internal routing and Cloudflare Zero Trust for external access, I keep my services private while still maintaining the flexibility of a public-facing domain.

## Next Steps

This project isn't just about managing chores—it's about managing complexity. By treating my infrastructure as code, I've built a foundation that allows me to deploy new services in minutes rather than hours.
