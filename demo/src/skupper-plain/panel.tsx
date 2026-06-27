export function SkupperPlainPanel() {
	return (
		<section className="border-muted bg-canvas-subtle grid gap-2 border px-4 py-3 text-sm md:grid-cols-2">
			<div>
				<span className="text-muted">Scenario:</span> Skupper plain Webernetes
			</div>
			<div>
				<span className="text-muted">Model:</span> one simulated cluster, two namespaces
			</div>
			<div>
				<span className="text-muted">West:</span> listening site
			</div>
			<div>
				<span className="text-muted">East:</span> connecting site
			</div>
			<div>
				<span className="text-muted">Routing key:</span> backend
			</div>
			<div>
				<span className="text-muted">Path:</span> frontend -&gt; listener -&gt; connector -&gt;
				backend
			</div>
			<div className="md:col-span-2">
				This is a simulation of east/west traffic shape using ordinary Webernetes Deployments and
				Services, not real Skupper.
			</div>
		</section>
	);
}
