export function SkupperGrpcPanel() {
	return (
		<section className="border-muted bg-canvas-subtle grid gap-2 border px-4 py-3 text-sm md:grid-cols-2">
			<div>
				<span className="text-muted">Scenario:</span> Skupper gRPC Webernetes
			</div>
			<div>
				<span className="text-muted">Model:</span> one simulated cluster, three namespaces
			</div>
			<div>
				<span className="text-muted">Site A:</span> frontend, catalog, recommendation, load
			</div>
			<div>
				<span className="text-muted">Site B:</span> checkout, cart, currency, ad, redis
			</div>
			<div>
				<span className="text-muted">Site C:</span> email, payment, shipping
			</div>
			<div>
				<span className="text-muted">Protocol:</span> gRPC-shaped HTTP simulation
			</div>
			<div className="md:col-span-2">
				Load generator traffic enters frontend on site A, then follows Skupper-style listener and
				connector hops to services distributed across sites A, B, and C.
			</div>
		</section>
	);
}
