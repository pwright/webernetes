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
		const lowerName = name.toLowerCase();
		if (lowerName === webernetesRequestIdHeader.toLowerCase() || lowerName === "host") {
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

type RouterRoute = {
	connectorSite: string;
	host: string;
	listener: string;
	listenerSite: string;
	port: number;
	routingKey: string;
	targetURL: string;
};

export class SkupperGrpcRouterImage extends w8s.BaseImage {
	static readonly imageName = "demo/skupper-grpc-router";
	static readonly imageVersion = "1.0";

	readonly defaultCommand = ["router"];

	override async exec(ctx: w8s.ProcessContext, argv: readonly string[]): Promise<number> {
		if (argv[0] !== "router") {
			return await super.exec(ctx, argv);
		}

		const siteID = env(ctx, "SITE_ID", "grpc-a");
		const transportPort = Number(env(ctx, "TRANSPORT_PORT", "7777"));
		const routes = parseRoutes(ctx.env.get("ROUTES"));
		const listenerPorts = new Set(
			routes.filter((route) => route.listenerSite === siteID).map((route) => route.port),
		);

		for (const port of listenerPorts) {
			ctx.listenHttp(port, async (_ctx, request) => {
				const route = sourceRoute(routes, siteID, port, request);
				if (!route) {
					return jsonResponse(404, {
						status: "not_found",
						protocol: "grpc-simulated",
						service: "router",
						site: siteID,
						message: `no listener route for ${request.host}`,
					});
				}

				if (route.connectorSite === siteID) {
					return await forwardToTarget(ctx, request, route, siteID);
				}

				try {
					return await ctx.fetch(
						`http://skupper-router.${route.connectorSite}.svc.cluster.local:${transportPort}${request.url.pathname}`,
						requestInit(
							request,
							forwardingHeaders(request, routerHeaders(route, siteID, "source")),
						),
					);
				} catch {
					return jsonResponse(503, {
						status: "unavailable",
						protocol: "grpc-simulated",
						service: "router",
						site: siteID,
						listener: route.listener,
						routingKey: route.routingKey,
						message: "destination router is unavailable",
					});
				}
			});
		}

		ctx.listenHttp(transportPort, async (_ctx, request) => {
			const routingKey = getHeaderValue(request.header, "x-skupper-sim-routing-key");
			const route = routes.find(
				(candidate) => candidate.routingKey === routingKey && candidate.connectorSite === siteID,
			);
			if (!route) {
				return jsonResponse(404, {
					status: "not_found",
					protocol: "grpc-simulated",
					service: "router",
					site: siteID,
					routingKey,
					message: "no connector route for routing key",
				});
			}

			return await forwardToTarget(ctx, request, route, siteID);
		});

		return await ctx.waitUntilKilled();
	}
}

async function forwardToTarget(
	ctx: w8s.ProcessContext,
	request: w8s.HttpRequest,
	route: RouterRoute,
	siteID: string,
): Promise<w8s.HttpResponse> {
	try {
		return await ctx.fetch(
			`${route.targetURL}${request.url.pathname}`,
			requestInit(request, forwardingHeaders(request, routerHeaders(route, siteID, "connector"))),
		);
	} catch {
		return jsonResponse(503, {
			status: "unavailable",
			protocol: "grpc-simulated",
			service: "router",
			site: siteID,
			listener: route.listener,
			routingKey: route.routingKey,
			message: "target service is unavailable",
		});
	}
}

function routerHeaders(
	route: RouterRoute,
	siteID: string,
	stage: "connector" | "source",
): Record<string, string> {
	return {
		"x-demo-protocol": "grpc-simulated",
		"x-skupper-sim-hop": `router:${stage}`,
		"x-skupper-sim-listener": route.listener,
		"x-skupper-sim-routing-key": route.routingKey,
		"x-skupper-sim-from-site": route.listenerSite,
		"x-skupper-sim-router-site": siteID,
		"x-skupper-sim-to-site": route.connectorSite,
	};
}

function parseRoutes(value: string | undefined): RouterRoute[] {
	if (!value) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter(isRouterRoute) : [];
	} catch {
		return [];
	}
}

function isRouterRoute(value: unknown): value is RouterRoute {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const route = value as Record<string, unknown>;
	return (
		typeof route.connectorSite === "string" &&
		typeof route.host === "string" &&
		typeof route.listener === "string" &&
		typeof route.listenerSite === "string" &&
		typeof route.port === "number" &&
		typeof route.routingKey === "string" &&
		typeof route.targetURL === "string"
	);
}

function sourceRoute(
	routes: RouterRoute[],
	siteID: string,
	port: number,
	request: w8s.HttpRequest,
): RouterRoute | undefined {
	const host = requestHostName(request);
	const candidates = routes.filter((route) => route.listenerSite === siteID && route.port === port);
	return (
		candidates.find((route) => route.host === host || route.routingKey === host) ??
		(candidates.length === 1 ? candidates[0] : undefined)
	);
}

function requestHostName(request: w8s.HttpRequest): string {
	return request.host.split(":", 1)[0] || request.url.hostname;
}

function getHeaderValue(header: w8s.HttpHeader, name: string): string | undefined {
	const lowerName = name.toLowerCase();
	const key = Object.keys(header).find((candidate) => candidate.toLowerCase() === lowerName);
	return key ? header[key]?.[0] : undefined;
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
