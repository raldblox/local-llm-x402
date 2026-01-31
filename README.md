# local-llm-x402

> **Expose local AI models to the internet with usage-based pricing, enforced via Aptos x402.**

local-llm-x402 is a production-oriented prototype that shows how **locally running AI models** can be safely exposed to external users and monetized on a **per-request basis**, without API keys, subscriptions, or centralized billing systems.

The core idea is simple:

* A **host** runs a model locally (using LM Studio)
* The host goes online and claims a room
* **Guests** join instantly through a familiar chat UI
* Guest requests are charged per usage via HTTP 402 (Aptos x402)
* Inference runs on the host’s machine and responses are returned with receipts

This repository demonstrates the full end-to-end flow, from local inference to on-chain settlement.

---

## What exists today

This project is intentionally focused on proving the core primitives required for public use.

### ✅ Working today

* Host / Guest model with a shared chat interface
* Local inference via **LM Studio** (OpenAI-compatible REST API)
* Host-controlled pricing (usage-based)
* Aptos **x402** payment enforcement for guest requests
* Per-message receipts (tx reference + usage metadata)
* Clear separation between local compute and cloud middleware
* Clean ChatGPT-style UI built with modern React tooling

The system already demonstrates a complete value loop:
local compute → external usage → enforced payment → transparent receipt.

---

## Why this matters

As local and edge AI becomes more powerful, compute is increasingly distributed, but **monetization and access control remain centralized**.

local-llm-x402 introduces a different model:

* Models stay local
* Access is granted per request
* Payment is enforced at the protocol layer
* Anyone can become a host

This unlocks new use cases for:

* Individual creators hosting personal or fine-tuned models
* Teams sharing internal AI tools safely
* Agents paying for intelligence on demand
* Temporary or time-based AI access without long-term accounts

---

## High-level architecture

```
Host machine
  ├─ Browser (chat UI)
  ├─ Local LM Studio proxy (Fastify + CORS)
  └─ LM Studio model server

Cloud (Vercel)
  └─ Next.js API routes
      └─ Aptos x402 middleware (payment enforcement)
```

Key design choices:

* **Inference stays local** to the host
* **Payments are enforced in the cloud** using x402
* The browser bridges the two via a local proxy
* Vercel never needs access to the host’s machine

---

## Current capabilities

### Host

* Connect a local LM Studio instance
* Detect available models
* Select a model and set a usage rate
* Go online as the active host
* Receive payments when guests use the model

### Guest

* Join instantly via a shared room
* Chat with the host’s local model
* Pay only when sending requests
* View receipts and usage metadata per message

---

## Roadmap toward public use

The following items are planned to evolve this prototype into a public-ready system:

* **Room IDs per host** (multiple concurrent hosts)
* Redis-backed room state and message persistence
* Proper host presence detection and failover
* Real-time sync via Redis streams or SSE
* Streaming model responses
* Support for additional local runtimes and providers
* Hardened billing UX and clearer usage breakdowns
* Rate limiting and abuse protection
* Optional wallet-based auth (beyond demo mode)

The goal is to keep the system simple while making it reliable and extensible.

---

## Requirements

* Node.js 18+
* LM Studio installed locally
* At least one LM Studio-compatible model downloaded

---

## Running the system locally

Clone the repository:

```
git clone https://github.com/raldblox/local-llm-x402.git
cd local-llm-x402
```

Install dependencies:

```
npm install
```

Start the development environment:

```
npm run dev
```

This starts:

* The Next.js app
* A local LM Studio proxy at `http://127.0.0.1:4312`

Open in your browser:

```
http://localhost:3000/demo/host
```

Make sure LM Studio is running and its local server is enabled.

---

## Using with Vercel deployments

When deployed on Vercel, the local proxy must still run on the host’s machine.

Why:

* Vercel cannot access `localhost:1234`
* The browser can, through the local proxy

Typical flow:

1. Run `npm run dev` locally (starts proxy)
2. Open the deployed Vercel URL in the same browser
3. Model detection and chat work through `127.0.0.1:4312`

This design keeps local compute private and controlled by the host.

---

## Environment variables

```
NEXT_PUBLIC_DEMO_HOST_PRIVATE_KEY=
NEXT_PUBLIC_DEMO_GUEST_PRIVATE_KEY=
NEXT_PUBLIC_DEMO_HOST_ADDRESS=
NEXT_PUBLIC_DEMO_GUEST_ADDRESS=

PAYMENT_RECIPIENT_ADDRESS=
FACILITATOR_URL=https://x402-navy.vercel.app/facilitator/

LM_STUDIO_PROXY_BASE_URL=http://127.0.0.1:4312
LM_STUDIO_DEFAULT_TARGET_URL=http://127.0.0.1:1234
```

---

## License

MIT

---

## TL;DR

Run AI locally. Expose it through a shared room. Charge by usage. Enforce payment with HTTP 402.
