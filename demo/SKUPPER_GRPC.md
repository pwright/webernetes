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
router. The destination router uses the matching connector definition as route
metadata, labels the request with that routing key, and forwards directly to the
real workload Service in the site that owns the workload.

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
- Skupper-style Listener, Router, and Connector route metadata.
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

## Troubleshooting

### `no listener route for frontend`

If a nested response contains a router body like this:

```json
{
	"status": "not_found",
	"protocol": "grpc-simulated",
	"service": "router",
	"site": "grpc-b",
	"message": "no listener route for frontend"
}
```

the router received traffic for a listener Service, but the request host did not
match any listener name on that site.

The example that exposed this was a `checkoutservice` response with failed
upstreams for `shippingservice` and `paymentservice`. Both are reached from
`grpc-b` through listener Services on port `50051`, so the router needs the
target host to distinguish `shippingservice:50051` from `paymentservice:50051`.
The failing request still carried `Host: frontend` from the original frontend
request. The router therefore saw port `50051` plus host `frontend`, and there
is no `frontend` listener on `grpc-b`.

That failure is a simulator forwarding bug, not an intended Skupper behavior.
Forwarded simulator requests should preserve tracing headers such as
`X-Demo-Request-Id`, `x-skupper-sim-listener`, and `x-skupper-sim-routing-key`,
but they must not preserve the stale HTTP `Host` header. Each `ctx.fetch()` call
should let the network layer set `Host` from the URL being called.

After the fix, `checkoutservice` calling `shippingservice:50051` reaches the
`grpc-b` router as `shippingservice`, crosses to the `grpc-c` router, then
continues directly to `shippingservice-real`. The connector is represented by
route metadata and request labels rather than a separate connector pod.

### Reading nested status values

Top-level service responses aggregate downstream calls. A response from
`checkoutservice` with `"status": "error"` means at least one downstream call
returned an error status. Look under `upstream` to find the first failing
dependency. In the example above, `productcatalogservice`, `emailservice`,
`currencyservice`, and `cartservice` succeeded, while `shippingservice` and
`paymentservice` failed at the router lookup step.
