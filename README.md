# local-llm-x402

> **Expose your local AI model to the internet with usage-based, token‑metered inference pricing using Aptos x402.**

local-llm-x402 is a minimal, production‑grade gateway that lets anyone expose a **locally running LLM** via LM Studio as a **paid inference API**, using a familiar, usage‑based pricing model where cost is derived from tokens generated per request.

Payments are enforced directly at the HTTP layer using **Aptos x402 (HTTP 402 – Payment Required)**, turning a standard inference endpoint into a monetizable, pay‑per‑use service without accounts, subscriptions, or custom billing infrastructure.

---

## What this is

- A **paid inference gateway** for local LLMs
- A bridge from **localhost → internet**
- A **token‑metered pricing model** for generation
- Enforced using **Aptos x402**, not API keys

If you can run a model locally, you can sell access to it.

---

## The familiar pricing model

AI developers already understand this model:

- You request a generation with a `max_tokens` limit
- Pricing is derived from token usage
- Each request has a clear, deterministic cost

local-llm-x402 follows the same pattern:

- **Price is computed per request** based on requested output tokens
- **Payment happens before inference** using x402
- **Actual tokens used** are returned in the response for transparency

This mirrors how modern AI services price completions, while running entirely on **your own hardware**.

---

## Why x402

Traditional AI monetization relies on:

- API keys
- Centralized billing accounts
- Monthly invoices and usage reconciliation

x402 replaces this with a native web primitive:

- HTTP `402 Payment Required`
- On‑chain settlement
- Stateless, request‑level payments

With x402:

- Every inference call is self‑contained
- Payments are enforced by middleware
- No user accounts are required

This makes AI access composable for:

- Agents
- Scripts
- Other APIs

---

## Host instructions

The host is the owner of the local model and the payment destination.

### Prerequisites

- LM Studio running locally with an OpenAI-compatible server enabled
- Petra Wallet (or any Aptos-compatible wallet)
- Aptos testnet USDC for receiving payments

### Steps

1. **Run your local model**\
   Start LM Studio and enable the local inference server.

2. **Open the host console**\
   Visit `/host` in the app.

3. **Connect wallet**\
   Connect your Petra wallet. This wallet address becomes the **payment receiver**.

4. **Set pricing**\
   Define the rate in USDC (for example: price per 1,000 output tokens).

5. **Go online**\
   Once online, the system creates a **shared AI room** bound to:

   - Your wallet address (identity)
   - Your pricing configuration
   - Your local model runtime

6. **Share access URL**\
   Share the generated URL. The link encodes:

   - Host payment address
   - Pricing rate

When the host is online, the AI room remains active and listens for paid prompts.

---

## Guest instructions

Guests are users or agents who want to access the host’s local model.

### Steps

1. **Open shared URL**\
   Visit the host’s shared link.

2. **Presence check**\
   The app verifies whether the host and AI room are currently online.

   - If offline, the guest is shown an unavailable state

3. **Connect wallet**\
   Connect Petra wallet. Wallet address is used as the guest identity.

4. **Approve x402 payment**\
   On first request, the guest approves an Aptos x402 payment challenge.

5. **Chat with the model**

   - Prompts are sent into the shared AI room
   - Payments are enforced before execution
   - Responses are streamed back into the live conversation

Each message is:

- Wallet-identified
- Usage-priced
- On-chain settled

---

## Architecture (minimal)

```
Host (Browser)
  ├─ Host UI (sets price + payment address)
  ├─ Next.js Gateway (x402 middleware + room server)
  └─ LM Studio (localhost inference)

Guests (Browser)
  ├─ Guest UI (connect wallet → approve x402 → chat)
  └─ Room feed (shared conversation)
```

- The gateway is the **only public surface**
- The model remains local
- Payments are validated before execution
- Conversation is shared in a room keyed by the host link

---

## What works today

- Token‑metered inference pricing
- Local LLMs via **LM Studio and compatible runtimes**
- Aptos testnet support
- Gas‑sponsored payments via x402 facilitator
- Minimal UI for host and guest suitable for production hardening

---

## Host instructions

The host runs the model locally and exposes a paid, shared AI room.

1. **Start LM Studio**

   - Run a model in LM Studio.
   - Enable the local server (OpenAI‑compatible endpoint).
   - Confirm the endpoint works locally.

2. **Open the Host page**

   - Connect your **Petra wallet**.
   - The app reads your wallet address as the **payment receiver**.

3. **Set pricing**

   - Choose a rate in **USDC per 1,000 output tokens** (recommended).
   - Pricing is computed per request using `max_tokens`.

4. **Generate your share link**

   - The app creates a room URL that includes pricing and receiver address.
   - Share the URL with guests.

### Share URL format

Example:

```
https://<your-domain>/r/<roomId>?recv=<aptos_address>&usdc_per_1k=<rate>
```

Notes:

- `roomId` identifies the shared AI room.
- `recv` is the host payment address.
- `usdc_per_1k` is the displayed rate and the server-side pricing input.

---

## Guest instructions

1. **Open the room link**

   - The page checks if the room is online.
   - If the host is offline, you will see “Host offline” with auto-retry.

2. **Connect your Petra wallet**

   - This becomes your identity in the room.

3. **Approve x402 payment when prompted**

   - Your first paid message triggers an HTTP 402 challenge.
   - Approve the USDC payment request in Petra.

4. **Chat**

   - Messages appear in a shared room feed.
   - The host gateway executes paid prompts against the local model and posts results back into the room.

Per message you will see:

- prompt
- paid amount
- transaction reference
- model response
- token usage

---

## Shared AI room behavior

This is intentionally simple for reliability:

- A room exists when the host shares a link.
- Guests post prompts into the room.
- The gateway watches the room feed for new prompts.
- For each prompt:
  - enforce x402 payment
  - run inference locally via LM Studio
  - append the response to the room feed

Identity is wallet-based:

- Host identity is the receiver wallet.
- Guest identity is the connected wallet.

---

## What this enables

- Sell access to personal or fine‑tuned models
- Expose private compute without exposing the machine
- Let agents pay for intelligence on demand
- Build paid AI endpoints without subscriptions

This is not a marketplace yet. It is the **primitive**.

---

## Status

This project is intentionally minimal and production‑oriented. It focuses on correctness, clarity, and alignment with how AI providers already price inference, while showcasing how Aptos x402 enables a cleaner, protocol‑level alternative to API key billing.

---

## TL;DR

Run a model locally. Expose it to the internet. Charge per generation. Enforce payment with HTTP 402.

That’s it.

