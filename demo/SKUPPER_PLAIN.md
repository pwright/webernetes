# Skupper plain Webernetes demo

This scenario simulates Skupper-style east/west service traffic using only
Webernetes primitives.

It uses one simulated cluster and two namespaces:

- `west`: listening site
- `east`: connecting site

The frontend runs in `west`.

The backend runs in `east`.

The frontend calls `http://backend/api/hello`.

In `west`, `backend` is a local Service backed by a listener pod.

The listener forwards to an east-side connector.

The connector forwards to the real backend.

## Run

```bash
pnpm install
pnpm demo
```

Open:

```text
http://localhost:5173/?scenario=skupper-plain
```

## What this demonstrates

- Local service name usage from the frontend.
- Listener-style local endpoint.
- Connector-style remote forwarding.
- Routing-key mental model.
- East/west traffic path.

## What this does not demonstrate

- Real Skupper.
- Cross-cluster connectivity.
- mTLS.
- AMQP.
- Claims or tokens.
- CRDs.
- Service sync.
- Real network boundaries.
