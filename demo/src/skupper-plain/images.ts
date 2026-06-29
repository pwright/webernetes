import * as w8s from "webernetes";

function jsonResponse(status: number, body: unknown): w8s.HttpResponse {
	return {
		status,
		header: { "Content-Type": ["application/json"] },
		body: `${JSON.stringify(body)}\n`,
	};
}

function parseJsonBody(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return body;
	}
}

function headerClone(header: w8s.HttpHeader): w8s.HttpHeader {
	const cloned: w8s.HttpHeader = {};
	for (const [name, values] of Object.entries(header)) {
		cloned[name] = [...values];
	}
	return cloned;
}

function headerSet(header: w8s.HttpHeader, name: string, value: string): void {
	const lowerName = name.toLowerCase();
	const key =
		Object.keys(header).find((candidate) => candidate.toLowerCase() === lowerName) ?? name;
	header[key] = [value];
}

function env(ctx: w8s.ProcessContext, name: string, fallback: string): string {
	return ctx.env.get(name) ?? fallback;
}

function forwardingHeaders(
	request: w8s.HttpRequest,
	values: Record<string, string>,
): w8s.HttpHeader {
	const headers = headerClone(request.header);
	for (const [name, value] of Object.entries(values)) {
		headerSet(headers, name, value);
	}
	return headers;
}

function requestInit(
	request: w8s.HttpRequest,
	headers: w8s.HttpHeader,
): Parameters<w8s.ProcessContext["fetch"]>[1] {
	return {
		method: request.method,
		headers,
		body: request.body,
	};
}

function trafficGeneratorIntervalMs(value: string | undefined): number {
	const requestsPerSecond = Number(value ?? "1");
	if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
		return 1000;
	}
	return 1000 / requestsPerSecond;
}

export class SkupperPlainFrontendImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-plain-frontend";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["frontend"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "frontend") {
			return await super.exec(ctx, argv);
		}

		ctx.listenHttp(8080, async (_ctx, request) => {
			if (
				(request.method !== "GET" || request.url.pathname !== "/") &&
				(request.method !== "POST" || request.url.pathname !== "/checkout")
			) {
				return jsonResponse(404, { status: "not_found", service: "frontend", site: "west" });
			}

			const called = "http://backend/api/hello";
			try {
				const backendResponse = await ctx.fetch(called, {
					method: "GET",
					headers: {
						"x-demo-source": "frontend",
						"x-routing-key": "backend",
					},
				});
				if (backendResponse.status >= 400) {
					return jsonResponse(502, {
						status: "error",
						service: "frontend",
						site: "west",
						called,
						message: "backend request failed",
						backend: parseJsonBody(backendResponse.body),
					});
				}
				return jsonResponse(200, {
					status: "ok",
					service: "frontend",
					site: "west",
					called,
					backend: parseJsonBody(backendResponse.body),
				});
			} catch (error) {
				return jsonResponse(502, {
					status: "error",
					service: "frontend",
					site: "west",
					called,
					message: error instanceof Error ? error.message : String(error),
					backend: {},
				});
			}
		});

		return await ctx.waitUntilKilled();
	}
}

export class SkupperPlainBackendImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-plain-backend";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["backend"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "backend") {
			return await super.exec(ctx, argv);
		}

		ctx.listenHttp(8080, async (_ctx, request) => {
			if (request.method !== "GET" || request.url.pathname !== "/api/hello") {
				return jsonResponse(404, { status: "not_found", service: "backend", site: "east" });
			}
			return jsonResponse(200, {
				status: "ok",
				service: "backend",
				site: "east",
				message: "Hello from the backend on the connecting site",
			});
		});

		return await ctx.waitUntilKilled();
	}
}

export class SkupperPlainListenerImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-plain-listener";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["listener"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "listener") {
			return await super.exec(ctx, argv);
		}

		const siteID = env(ctx, "SITE_ID", "west");
		const routingKey = env(ctx, "ROUTING_KEY", "backend");
		const connectorURL = env(
			ctx,
			"CONNECTOR_URL",
			"http://backend-connector.east.svc.cluster.local",
		);

		ctx.listenHttp(8080, async (_ctx, request) => {
			try {
				return await ctx.fetch(
					`${connectorURL}${request.url.pathname}`,
					requestInit(
						request,
						forwardingHeaders(request, {
							"x-skupper-sim-hop": "listener",
							"x-skupper-sim-routing-key": routingKey,
							"x-skupper-sim-from-site": siteID,
							"x-skupper-sim-to-site": "east",
						}),
					),
				);
			} catch {
				return jsonResponse(503, {
					status: "unavailable",
					service: "listener",
					site: siteID,
					routingKey,
					message: "connector is unavailable",
				});
			}
		});

		return await ctx.waitUntilKilled();
	}
}

export class SkupperPlainConnectorImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-plain-connector";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["connector"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "connector") {
			return await super.exec(ctx, argv);
		}

		const siteID = env(ctx, "SITE_ID", "east");
		const routingKey = env(ctx, "ROUTING_KEY", "backend");
		const targetURL = env(ctx, "TARGET_URL", "http://backend.east.svc.cluster.local");

		ctx.listenHttp(8080, async (_ctx, request) => {
			try {
				return await ctx.fetch(
					`${targetURL}${request.url.pathname}`,
					requestInit(
						request,
						forwardingHeaders(request, {
							"x-skupper-sim-hop": "connector",
							"x-skupper-sim-routing-key": routingKey,
						}),
					),
				);
			} catch (error) {
				return jsonResponse(502, {
					status: "error",
					service: "connector",
					site: siteID,
					routingKey,
					message: error instanceof Error ? error.message : String(error),
				});
			}
		});

		return await ctx.waitUntilKilled();
	}
}

export class SkupperPlainClientImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-plain-client";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["client"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "client") {
			return await super.exec(ctx, argv);
		}

		const intervalMs = trafficGeneratorIntervalMs(ctx.env.get("REQUESTS_PER_SECOND"));
		for (;;) {
			void ctx
				.fetch("http://frontend/checkout", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-demo-source": "client",
						"x-routing-key": "backend",
					},
					body: JSON.stringify({ source: "client" }),
				})
				.catch((error) => {
					if (!ctx.err()) {
						ctx.writeStderr(`${error instanceof Error ? error.message : String(error)}\n`);
					}
				});
			await ctx.sleep(intervalMs);
		}
	}
}
