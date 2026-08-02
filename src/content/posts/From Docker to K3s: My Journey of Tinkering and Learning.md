---
title: "From Docker to K3s: My Journey of Tinkering and Learning"
date: 2026-05-05
tags: ["Homelab", "Kubernetes", "K3s", "Proxmox", "Docker"]
excerpt: "Trading a folder full of unruly Docker Compose files for a Proxmox-hosted K3s cluster — why I blew up a perfectly working homelab just to learn something new."
---

# From Docker to K3s: My Journey of Tinkering and Learning

I'll be honest: my homelab started as a bit of a "container hoarder" situation. I had folders full of Docker Compose files, a bunch of random containers running, and honestly? It was great until it wasn't.

One day I realized I was spending more time fixing config files in random folders than actually using my home services. I wanted to learn something new, tinker with some bigger tech, and maybe — just maybe — stop breaking my own stuff quite so often.

So, I decided to blow it all up and rebuild. Here's the story of my move to Proxmox and K3s.

## The "NUC" of the Problem

My hardware heartthrob is an Intel NUC. It's quiet, it doesn't heat up my office, and it's a powerhouse for home services. To make my life easier, I installed Proxmox.

If you aren't using Proxmox yet, you're missing out. It's basically the "cheat code" for homelabbers. You want to try a new OS? Done. You messed up a config and need to undo everything you did in the last hour? One click, and it's like it never happened. It's turned my homelab from a stress test into a giant playground.

## Why K3s? (Because "Why Not?")

I could have stayed with Docker. It worked! But where's the fun in that? I wanted to see what all the fuss was about with Kubernetes.

I settled on K3s. It's the "lite" version of Kubernetes — all the power, none of the "I need a data center to run this" bloat.

Was the learning curve a bit like walking into a wall? Absolutely. Docker is easy: "Run this image, connect this port." K3s is more like: "Here is a Deployment, an Ingress, and a Service, and also everything you know about containers is now technically a Pod."

It's definitely overkill for a Plex server, but for the sake of learning? It's been an absolute blast.

## The Current "Lab"

Right now, my lab is pretty simple:

- **The Host:** The NUC doing the heavy lifting with Proxmox.
- **The Guest:** A single Ubuntu VM running my K3s "cluster."
- **The Goal:** It's a one-node setup for now, but I've got my eyes peeled on some cheap hardware to add a second node later. Once I have two, I can finally start breaking things across multiple machines!

To be continued...