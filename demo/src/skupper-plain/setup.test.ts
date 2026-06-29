import { expect, it } from "vitest";

import { browser } from "../../../src/test/describe";
import { skupperPlainResources } from "./setup";

type TestServiceResource = {
	kind: "Service";
	metadata?: { name?: string; namespace?: string };
	spec?: { selector?: Record<string, string> };
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
				}>;
				nodeName?: string;
			};
		};
	};
};

browser.describe("skupper plain resource builders", () => {
	it("creates west and east namespaces", () => {
		const namespaces = skupperPlainResources().filter((resource) => resource.kind === "Namespace");

		expect(namespaces.map((resource) => resource.metadata?.name).toSorted()).toEqual([
			"east",
			"west",
		]);
	});

	it("routes the west backend Service to the listener", () => {
		const service = serviceResource("west", "backend");

		expect(service.spec?.selector).toEqual({ app: "backend-listener" });
	});

	it("routes east Services to the real backend and connector", () => {
		expect(serviceResource("east", "backend").spec?.selector).toEqual({ app: "backend" });
		expect(serviceResource("east", "backend-connector").spec?.selector).toEqual({
			app: "backend-connector",
		});
	});

	it("sets listener and connector routing environment", () => {
		expect(containerEnv("west", "backend-listener")).toEqual({
			SITE_ID: "west",
			ROUTING_KEY: "backend",
			CONNECTOR_URL: "http://backend-connector.east.svc.cluster.local",
		});
		expect(containerEnv("east", "backend-connector")).toEqual({
			SITE_ID: "east",
			ROUTING_KEY: "backend",
			TARGET_URL: "http://backend.east.svc.cluster.local",
		});
	});

	it("creates a west-side client workload to drive traffic", () => {
		const container = deploymentResource("west", "client").spec?.template?.spec?.containers?.[0];

		expect(container).toMatchObject({
			name: "client",
			image: "demo/skupper-plain-client:1.0",
		});
	});

	it("pins workloads to west and east nodes", () => {
		expect(deploymentNodeName("west", "client")).toBe("west");
		expect(deploymentNodeName("west", "frontend")).toBe("west");
		expect(deploymentNodeName("west", "backend-listener")).toBe("west");
		expect(deploymentNodeName("east", "backend")).toBe("east");
		expect(deploymentNodeName("east", "backend-connector")).toBe("east");
	});
});

function serviceResource(namespace: string, name: string) {
	const service = skupperPlainResources().find(
		(resource) =>
			resource.kind === "Service" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	);
	expect(service).toBeDefined();
	return service as TestServiceResource;
}

function containerEnv(namespace: string, name: string): Record<string, string> {
	const container = deploymentResource(namespace, name).spec?.template?.spec?.containers?.[0];
	expect(container).toBeDefined();
	return Object.fromEntries((container?.env ?? []).map((item) => [item.name, item.value ?? ""]));
}

function deploymentResource(namespace: string, name: string): TestDeploymentResource {
	const deployment = skupperPlainResources().find(
		(resource) =>
			resource.kind === "Deployment" &&
			resource.metadata?.namespace === namespace &&
			resource.metadata.name === name,
	) as TestDeploymentResource | undefined;
	expect(deployment).toBeDefined();
	return deployment;
}

function deploymentNodeName(namespace: string, name: string): string | undefined {
	return deploymentResource(namespace, name).spec?.template?.spec?.nodeName;
}
