# Skupper gRPC Webernetes demo

This scenario simulates the topology from `skupper-example-grpc-main` using
ordinary Webernetes primitives.

It uses one simulated cluster and three namespaces:

- `grpc-a`: frontend, recommendation, product catalog, and load generator
- `grpc-b`: checkout, cart, currency, Redis, and ad services
- `grpc-c`: email, payment, and shipping services

It shows three simulated nodes from left to right:

- `grpc-a`
- `grpc-b`
- `grpc-c`

The load generator runs in `grpc-a` and calls `http://frontend:80`.

The frontend calls service names from the original example, such as
`productcatalogservice:3550`, `checkoutservice:5050`, and
`shippingservice:50051`.

Listener Services keep those original service names local to each simulated
site. Each Listener Service selects the local `skupper-router` pod. The source
router labels the request with the listener name, such as
`grpc-a/adservice:9555`, and forwards remote traffic to the destination site's
router. The destination router forwards to the connector pod for the matching
routing key, and the connector forwards to the real workload Service in the site
that owns the workload.

## Run

```bash
pnpm install
pnpm demo
```

Open:

```text
http://localhost:5173/?scenario=skupper-grpc
```

## Source shape

This scenario mirrors the resource split in:

- `skupper-example-grpc-main/resources-a`
- `skupper-example-grpc-main/resources-b`
- `skupper-example-grpc-main/resources-c`
- `skupper-example-grpc-main/deployment-loadgenerator.yaml`

The load generator manifest is used as the traffic-source model:
`FRONTEND_ADDR=frontend:80` and `USERS=10`.

## What this demonstrates

- A three-site service topology.
- Skupper-style Listener, Router, and Connector hops.
- Routing keys for the Online Boutique service names.
- Short moving labels for router-to-router routing keys.
- Traffic entering at the frontend on site A.
- Remote dependency calls from site A to B and C.
- Remote dependency calls from checkout on site B to C.

## What this does not demonstrate

- Real Skupper.
- Real gRPC or TCP forwarding.
- Cross-cluster connectivity.
- mTLS.
- AMQP.
- Claims or tokens.
- CRDs.
- Service sync.
- Init containers.
- Kubernetes volumes.
- Real network boundaries.
