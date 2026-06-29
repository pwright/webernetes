import * as w8s from "webernetes";

import { demoRequestIdHeader } from "../helpers";

const webernetesRequestIdHeader = "X-Webernetes-Request-Id";

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
		if (name.toLowerCase() === webernetesRequestIdHeader.toLowerCase()) {
			continue;
		}
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

function env(ctx: w8s.ProcessContext, name: string, fallback: string): string {
	return ctx.env.get(name) ?? fallback;
}

function jsonBody(body: string | undefined): Record<string, unknown> {
	if (body === undefined || body.length === 0) {
		return {};
	}
	const parsed = parseJsonBody(body);
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: {};
}

function serviceUrl(address: string): string {
	return address.startsWith("http://") || address.startsWith("https://")
		? address
		: `http://${address}`;
}

function trafficGeneratorIntervalMs(users: string | undefined): number {
	const userCount = Number(users ?? "10");
	if (!Number.isFinite(userCount) || userCount <= 0) {
		return 1000;
	}
	return Math.max(200, 2000 / userCount);
}

function demoRequestId(): string {
	return Math.random().toString(36).slice(2, 10);
}

export class SkupperGrpcServiceImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-grpc-service";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["service"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "service") {
			return await super.exec(ctx, argv);
		}

		const service = env(ctx, "SERVICE_NAME", "service");
		const siteID = env(ctx, "SITE_ID", "grpc-a");
		const port = Number(env(ctx, "PORT", "8080"));
		const dependencies = env(ctx, "DEPENDENCIES", "")
			.split(",")
			.map((dependency) => dependency.trim())
			.filter((dependency) => dependency.length > 0);

		ctx.listenHttp(port, async (_ctx, request) => {
			if (request.method !== "GET" && request.method !== "POST") {
				return jsonResponse(405, { status: "method_not_allowed", service, site: siteID });
			}

			const upstream: Record<string, unknown> = {};
			for (const dependency of dependencies) {
				const [dependencyName, dependencyAddress = dependency] = dependency.split("=");
				const called = serviceUrl(dependencyAddress);
				try {
					const response = await ctx.fetch(`${called}/grpc/${service}`, {
						method: "POST",
						headers: forwardingHeaders(request, {
							"x-demo-protocol": "grpc-simulated",
							"x-demo-source-service": service,
							"x-demo-target-service": dependencyName,
						}),
						body: JSON.stringify({
							caller: service,
							sourceSite: siteID,
							requestPath: request.url.pathname,
						}),
					});
					upstream[dependencyName] = {
						status: response.status,
						body: parseJsonBody(response.body),
					};
				} catch (error) {
					upstream[dependencyName] = {
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					};
				}
			}

			const failed = Object.values(upstream).some(
				(value) =>
					typeof value === "object" &&
					value !== null &&
					"status" in value &&
					typeof value.status === "number" &&
					value.status >= 400,
			);

			return jsonResponse(failed ? 502 : 200, {
				status: failed ? "error" : "ok",
				protocol: "grpc-simulated",
				service,
				site: siteID,
				port,
				request: {
					method: request.method,
					path: request.url.pathname,
					body: jsonBody(request.body),
				},
				upstream,
			});
		});

		return await ctx.waitUntilKilled();
	}
}

export class SkupperGrpcListenerImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-grpc-listener";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["listener"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "listener") {
			return await super.exec(ctx, argv);
		}

		const siteID = env(ctx, "SITE_ID", "grpc-a");
		const routingKey = env(ctx, "ROUTING_KEY", "service");
		const connectorURL = env(ctx, "CONNECTOR_URL", "http://connector");
		const port = Number(env(ctx, "PORT", "8080"));

		ctx.listenHttp(port, async (_ctx, request) => {
			try {
				return await ctx.fetch(
					`${connectorURL}${request.url.pathname}`,
					requestInit(
						request,
						forwardingHeaders(request, {
							"x-demo-protocol": "grpc-simulated",
							"x-skupper-sim-hop": "listener",
							"x-skupper-sim-routing-key": routingKey,
							"x-skupper-sim-from-site": siteID,
						}),
					),
				);
			} catch {
				return jsonResponse(503, {
					status: "unavailable",
					protocol: "grpc-simulated",
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

export class SkupperGrpcConnectorImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-grpc-connector";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["connector"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "connector") {
			return await super.exec(ctx, argv);
		}

		const siteID = env(ctx, "SITE_ID", "grpc-a");
		const routingKey = env(ctx, "ROUTING_KEY", "service");
		const targetURL = env(ctx, "TARGET_URL", "http://service-real");
		const port = Number(env(ctx, "PORT", "8080"));

		ctx.listenHttp(port, async (_ctx, request) => {
			try {
				return await ctx.fetch(
					`${targetURL}${request.url.pathname}`,
					requestInit(
						request,
						forwardingHeaders(request, {
							"x-demo-protocol": "grpc-simulated",
							"x-skupper-sim-hop": "connector",
							"x-skupper-sim-routing-key": routingKey,
							"x-skupper-sim-to-site": siteID,
						}),
					),
				);
			} catch (error) {
				return jsonResponse(502, {
					status: "error",
					protocol: "grpc-simulated",
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

export class SkupperGrpcLoadGeneratorImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-grpc-loadgenerator";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["loadgenerator"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "loadgenerator") {
			return await super.exec(ctx, argv);
		}

		const frontendURL = serviceUrl(env(ctx, "FRONTEND_ADDR", "frontend:80"));
		const intervalMs = trafficGeneratorIntervalMs(ctx.env.get("USERS"));
		for (;;) {
			void ctx
				.fetch(`${frontendURL}/checkout`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						[demoRequestIdHeader]: demoRequestId(),
						"x-demo-protocol": "grpc-simulated",
						"x-demo-source": "loadgenerator",
					},
					body: JSON.stringify({ source: "loadgenerator" }),
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
