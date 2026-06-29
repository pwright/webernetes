import { expect, it } from "vitest";

import { browser } from "../../../src/test/describe";
import { skupperGrpcResources } from "./setup";

type TestServiceResource = {
	kind: "Service";
	metadata?: { name?: string; namespace?: string };
	spec?: {
		ports?: Array<{ port?: number; targetPort?: number | string }>;
		selector?: Record<string, string>;
	};
};

type TestDeploymentResource = {
	kind: "Deployment";
	metadata?: { name?: string; namespace?: string };
	spec?: {
		template?: {
			spec?: {
				containers?: Array<{
					env?: Array<{ name: string; value?: string }>;
					image?: string;
					name?: string;
					ports?: Array<{ containerPort?: number }>;
				}>;
				nodeName?: string;
			};
		};
	};
};

browser.describe("skupper grpc resource builders", () => {
	it("creates one namespace per simulated site", () => {
		const namespaces = skupperGrpcResources().filter((resource) => resource.kind === "Namespace");

		expect(namespaces.map((resource) => resource.metadata?.name).toSorted()).toEqual([
			"grpc-a",
			"grpc-b",
			"grpc-c",
		]);
	});

	it("pins workloads to their simulated site nodes", () => {
		expect(deploymentNodeName("grpc-a", "frontend")).toBe("grpc-a");
		expect(deploymentNodeName("grpc-a", "loadgenerator")).toBe("grpc-a");
		expect(deploymentNodeName("grpc-b", "checkoutservice")).toBe("grpc-b");
		expect(deploymentNodeName("grpc-b", "cartservice")).toBe("grpc-b");
		expect(deploymentNodeName("grpc-c", "emailservice")).toBe("grpc-c");
		expect(deploymentNodeName("grpc-c", "shippingservice")).toBe("grpc-c");
	});

	it("keeps the load generator pointed at frontend:80", () => {
		expect(containerEnv("grpc-a", "loadgenerator")).toMatchObject({
			FRONTEND_ADDR: "frontend:80",
			USERS: "10",
		});
	});

	it("creates one router per simulated site", () => {
		expect(containerEnv("grpc-a", "skupper-router")).toMatchObject({
			SITE_ID: "grpc-a",
		});
		expect(containerEnv("grpc-b", "skupper-router")).toMatchObject({
			SITE_ID: "grpc-b",
		});
		expect(containerEnv("grpc-c", "skupper-router")).toMatchObject({
			SITE_ID: "grpc-c",
		});
		expect(servicePort("grpc-a", "skupper-router")).toEqual({
			port: 7777,
			targetPort: 7777,
		});
		expect(serviceResource("grpc-b", "skupper-router").spec?.selector).toEqual({
			app: "skupper-router",
		});
	});

	it("creates site A listener services for remote dependencies", () => {
		expect(servicePort("grpc-a", "cartservice")).toEqual({ port: 7070, targetPort: 7070 });
		expect(servicePort("grpc-a", "checkoutservice")).toEqual({ port: 5050, targetPort: 5050 });
		expect(servicePort("grpc-a", "currencyservice")).toEqual({ port: 7000, targetPort: 7000 });
		expect(servicePort("grpc-a", "shippingservice")).toEqual({ port: 50051, targetPort: 50051 });
	});

	it("creates site B listener services for site C dependencies", () => {
		expect(servicePort("grpc-b", "emailservice")).toEqual({ port: 8080, targetPort: 8080 });
		expect(servicePort("grpc-b", "paymentservice")).toEqual({
			port: 50051,
			targetPort: 50051,
		});
		expect(servicePort("grpc-b", "shippingservice")).toEqual({
			port: 50051,
			targetPort: 50051,
		});
	});

	it("routes listener services through the local router", () => {
		expect(serviceResource("grpc-a", "checkoutservice").spec?.selector).toEqual({
			app: "skupper-router",
		});
		expect(serviceResource("grpc-b", "paymentservice").spec?.selector).toEqual({
			app: "skupper-router",
		});
	});

	it("labels router traffic with listener and destination information", () => {
		const routes = JSON.parse(containerEnv("grpc-a", "skupper-router").ROUTES ?? "[]") as Array<{
			connectorSite?: string;
			listener?: string;
			routingKey?: string;
			targetURL?: string;
		}>;

		expect(routes).toContainEqual(
			expect.objectContaining({
				listener: "grpc-a/adservice:9555",
				routingKey: "adservice",
				connectorSite: "grpc-b",
				targetURL: "http://adservice-real.grpc-b.svc.cluster.local:9555",
			}),
		);
		expect(routes).toContainEqual(
			expect.objectContaining({
				listener: "grpc-a/shippingservice:50051",
				routingKey: "shippingservice",
				connectorSite: "grpc-c",
				targetURL: "http://shippingservice-real.grpc-c.svc.cluster.local:50051",
			}),
		);
	});

	it("does not create per-listener forwarding pods", () => {
		expect(deploymentExists("grpc-a", "checkoutservice-listener")).toBe(false);
		expect(deploymentExists("grpc-b", "paymentservice-listener")).toBe(false);
		expect(deploymentExists("grpc-a", "skupper-router")).toBe(true);
		expect(deploymentExists("grpc-b", "skupper-router")).toBe(true);
	});

	it("does not create connector forwarding pods or services", () => {
		expect(deploymentExists("grpc-b", "adservice-connector")).toBe(false);
		expect(deploymentExists("grpc-c", "shippingservice-connector")).toBe(false);
		expect(serviceExists("grpc-b", "adservice-connector")).toBe(false);
		expect(serviceExists("grpc-c", "shippingservice-connector")).toBe(false);
	});
});

function serviceResource(namespace: string, name: string): TestServiceResource {
	const service = skupperGrpcResources().find(
		(resource) =>
			resource.kind === "Service" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	);
	expect(service).toBeDefined();
	return service as TestServiceResource;
}

function servicePort(
	namespace: string,
	name: string,
): { port?: number; targetPort?: number | string } {
	const port = serviceResource(namespace, name).spec?.ports?.[0];
	expect(port).toBeDefined();
	return { port: port?.port, targetPort: port?.targetPort };
}

function containerEnv(namespace: string, name: string): Record<string, string> {
	const container = deploymentResource(namespace, name).spec?.template?.spec?.containers?.[0];
	expect(container).toBeDefined();
	return Object.fromEntries((container?.env ?? []).map((item) => [item.name, item.value ?? ""]));
}

function deploymentResource(namespace: string, name: string): TestDeploymentResource {
	const deployment = skupperGrpcResources().find(
		(resource) =>
			resource.kind === "Deployment" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	) as TestDeploymentResource | undefined;
	expect(deployment).toBeDefined();
	return deployment;
}

function deploymentExists(namespace: string, name: string): boolean {
	return skupperGrpcResources().some(
		(resource) =>
			resource.kind === "Deployment" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	);
}

function serviceExists(namespace: string, name: string): boolean {
	return skupperGrpcResources().some(
		(resource) =>
			resource.kind === "Service" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	);
}

function deploymentNodeName(namespace: string, name: string): string | undefined {
	return deploymentResource(namespace, name).spec?.template?.spec?.nodeName;
}
