# Skupper plain Webernetes demo

This scenario simulates Skupper-style east/west service traffic using only
Webernetes primitives.

It uses one simulated cluster and two namespaces:

- `west`: listening site
- `east`: connecting site

It shows two simulated nodes from left to right:

- `west`: listening site workloads
- `east`: connecting site workloads

The client and frontend run in the `west` namespace on the `west` node.

The backend runs in `east`.

The client generates demo traffic by calling `http://frontend/checkout`.

The frontend calls `http://backend/api/hello`.

In `west`, `backend` is a local Service backed by the `backend-listener` pod.

The `backend-listener` forwards to the east-side `backend-connector`.

The `backend-connector` forwards to the real `backend` pod in `east`.

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
- Client traffic entering the west site.
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
