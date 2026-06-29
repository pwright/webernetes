import * as w8s from "webernetes";

import {
	SkupperGrpcConnectorImage,
	SkupperGrpcListenerImage,
	SkupperGrpcLoadGeneratorImage,
	SkupperGrpcServiceImage,
} from "./images";

type SiteID = "grpc-a" | "grpc-b" | "grpc-c";

type ServiceDefinition = {
	dependencies?: string[];
	name: string;
	port: number;
	site: SiteID;
};

type ListenerDefinition = {
	name: string;
	port: number;
	site: SiteID;
};

type ConnectorDefinition = {
	name: string;
	port: number;
	site: SiteID;
};

const siteIDs: SiteID[] = ["grpc-a", "grpc-b", "grpc-c"];

const services: ServiceDefinition[] = [
	{
		site: "grpc-a",
		name: "frontend",
		port: 8080,
		dependencies: [
			"productcatalogservice=productcatalogservice:3550",
			"currencyservice=currencyservice:7000",
			"cartservice=cartservice:7070",
			"recommendationservice=recommendationservice:8080",
			"shippingservice=shippingservice:50051",
			"checkoutservice=checkoutservice:5050",
			"adservice=adservice:9555",
		],
	},
	{
		site: "grpc-a",
		name: "recommendationservice",
		port: 8080,
		dependencies: ["productcatalogservice=productcatalogservice:3550"],
	},
	{ site: "grpc-a", name: "productcatalogservice", port: 3550 },
	{
		site: "grpc-b",
		name: "checkoutservice",
		port: 5050,
		dependencies: [
			"productcatalogservice=productcatalogservice:3550",
			"shippingservice=shippingservice:50051",
			"paymentservice=paymentservice:50051",
			"emailservice=emailservice:8080",
			"currencyservice=currencyservice:7000",
			"cartservice=cartservice:7070",
		],
	},
	{ site: "grpc-b", name: "cartservice", port: 7070, dependencies: ["redis-cart=redis-cart:6379"] },
	{ site: "grpc-b", name: "currencyservice", port: 7000 },
	{ site: "grpc-b", name: "redis-cart", port: 6379 },
	{ site: "grpc-b", name: "adservice", port: 9555 },
	{ site: "grpc-c", name: "emailservice", port: 8080 },
	{ site: "grpc-c", name: "paymentservice", port: 50051 },
	{ site: "grpc-c", name: "shippingservice", port: 50051 },
];

const listeners: ListenerDefinition[] = [
	{ site: "grpc-a", name: "adservice", port: 9555 },
	{ site: "grpc-a", name: "cartservice", port: 7070 },
	{ site: "grpc-a", name: "checkoutservice", port: 5050 },
	{ site: "grpc-a", name: "currencyservice", port: 7000 },
	{ site: "grpc-a", name: "productcatalogservice", port: 3550 },
	{ site: "grpc-a", name: "recommendationservice", port: 8080 },
	{ site: "grpc-a", name: "shippingservice", port: 50051 },
	{ site: "grpc-b", name: "cartservice", port: 7070 },
	{ site: "grpc-b", name: "currencyservice", port: 7000 },
	{ site: "grpc-b", name: "emailservice", port: 8080 },
	{ site: "grpc-b", name: "paymentservice", port: 50051 },
	{ site: "grpc-b", name: "redis-cart", port: 6379 },
	{ site: "grpc-b", name: "shippingservice", port: 50051 },
	{ site: "grpc-b", name: "productcatalogservice", port: 3550 },
];

const connectors: ConnectorDefinition[] = [
	{ site: "grpc-a", name: "productcatalogservice", port: 3550 },
	{ site: "grpc-a", name: "recommendationservice", port: 8080 },
	{ site: "grpc-b", name: "checkoutservice", port: 5050 },
	{ site: "grpc-b", name: "cartservice", port: 7070 },
	{ site: "grpc-b", name: "currencyservice", port: 7000 },
	{ site: "grpc-b", name: "adservice", port: 9555 },
	{ site: "grpc-b", name: "redis-cart", port: 6379 },
	{ site: "grpc-c", name: "emailservice", port: 8080 },
	{ site: "grpc-c", name: "paymentservice", port: 50051 },
	{ site: "grpc-c", name: "shippingservice", port: 50051 },
];

export async function setupSkupperGrpc(cluster: w8s.Cluster): Promise<void> {
	cluster.registerImage(SkupperGrpcServiceImage);
	cluster.registerImage(SkupperGrpcListenerImage);
	cluster.registerImage(SkupperGrpcConnectorImage);
	cluster.registerImage(SkupperGrpcLoadGeneratorImage);

	await cluster.apply(skupperGrpcResources());
}

export function skupperGrpcResources(): w8s.ClusterApplyResource[] {
	const resources: w8s.ClusterApplyResource[] = siteIDs.map(namespace);

	resources.push(...services.flatMap(serviceResources));
	resources.push(...listeners.flatMap(listenerResources));
	resources.push(...connectors.flatMap(connectorResources));
	resources.push(loadGeneratorDeployment());

	return resources;
}

function serviceResources(definition: ServiceDefinition): w8s.ClusterApplyResource[] {
	const container: w8s.V1Container = {
		name: "server",
		image: "demo/skupper-grpc-service:1.0",
		ports: [{ name: "grpc", containerPort: definition.port }],
		env: [
			{ name: "SITE_ID", value: definition.site },
			{ name: "SERVICE_NAME", value: definition.name },
			{ name: "PORT", value: String(definition.port) },
			{ name: "DEPENDENCIES", value: (definition.dependencies ?? []).join(",") },
		],
	};

	const resources: w8s.ClusterApplyResource[] = [
		deployment({
			namespace: definition.site,
			name: definition.name,
			labels: workloadLabels(definition.name, definition.site, "service"),
			nodeName: definition.site,
			containers: [container],
		}),
		service({
			namespace: definition.site,
			name: realServiceName(definition.name),
			selector: { app: definition.name },
			port: definition.port,
		}),
	];

	if (definition.name === "frontend") {
		resources.push(
			service({
				namespace: definition.site,
				name: definition.name,
				selector: { app: definition.name },
				port: 80,
				targetPort: definition.port,
			}),
		);
	}

	return resources;
}

function listenerResources(definition: ListenerDefinition): w8s.ClusterApplyResource[] {
	const connector = connectorFor(definition.name);
	const container: w8s.V1Container = {
		name: "listener",
		image: "demo/skupper-grpc-listener:1.0",
		ports: [{ name: "grpc", containerPort: definition.port }],
		env: [
			{ name: "SITE_ID", value: definition.site },
			{ name: "ROUTING_KEY", value: definition.name },
			{ name: "PORT", value: String(definition.port) },
			{
				name: "CONNECTOR_URL",
				value: `http://${connectorDeploymentName(definition.name)}.${connector.site}.svc.cluster.local:${connector.port}`,
			},
		],
	};

	return [
		deployment({
			namespace: definition.site,
			name: listenerDeploymentName(definition.name),
			labels: workloadLabels(listenerDeploymentName(definition.name), definition.site, "listener"),
			nodeName: definition.site,
			containers: [container],
		}),
		service({
			namespace: definition.site,
			name: definition.name,
			selector: { app: listenerDeploymentName(definition.name) },
			port: definition.port,
		}),
	];
}

function connectorResources(definition: ConnectorDefinition): w8s.ClusterApplyResource[] {
	const container: w8s.V1Container = {
		name: "connector",
		image: "demo/skupper-grpc-connector:1.0",
		ports: [{ name: "grpc", containerPort: definition.port }],
		env: [
			{ name: "SITE_ID", value: definition.site },
			{ name: "ROUTING_KEY", value: definition.name },
			{ name: "PORT", value: String(definition.port) },
			{
				name: "TARGET_URL",
				value: `http://${realServiceName(definition.name)}.${definition.site}.svc.cluster.local:${definition.port}`,
			},
		],
	};

	return [
		deployment({
			namespace: definition.site,
			name: connectorDeploymentName(definition.name),
			labels: workloadLabels(
				connectorDeploymentName(definition.name),
				definition.site,
				"connector",
			),
			nodeName: definition.site,
			containers: [container],
		}),
		service({
			namespace: definition.site,
			name: connectorDeploymentName(definition.name),
			selector: { app: connectorDeploymentName(definition.name) },
			port: definition.port,
		}),
	];
}

function loadGeneratorDeployment(): w8s.ClusterApplyResource {
	return deployment({
		namespace: "grpc-a",
		name: "loadgenerator",
		labels: workloadLabels("loadgenerator", "grpc-a", "client"),
		nodeName: "grpc-a",
		containers: [
			{
				name: "main",
				image: "demo/skupper-grpc-loadgenerator:1.0",
				env: [
					{ name: "FRONTEND_ADDR", value: "frontend:80" },
					{ name: "USERS", value: "10" },
				],
			},
		],
	});
}

function namespace(name: string): w8s.ClusterApplyResource {
	return {
		apiVersion: "v1",
		kind: "Namespace",
		metadata: { name },
	};
}

function deployment({
	containers,
	labels,
	name,
	namespace,
	nodeName,
}: {
	containers: w8s.V1Container[];
	labels: Record<string, string>;
	name: string;
	namespace: string;
	nodeName: string;
}): w8s.ClusterApplyResource {
	return {
		apiVersion: "apps/v1",
		kind: "Deployment",
		metadata: {
			name,
			namespace,
			labels,
		},
		spec: {
			replicas: 1,
			selector: {
				matchLabels: {
					app: labels.app,
				},
			},
			template: {
				metadata: {
					labels,
				},
				spec: {
					containers,
					nodeName,
				},
			},
		},
	};
}

function service({
	name,
	namespace,
	port,
	selector,
	targetPort = port,
}: {
	name: string;
	namespace: string;
	port: number;
	selector: Record<string, string>;
	targetPort?: number;
}): w8s.ClusterApplyResource {
	return {
		apiVersion: "v1",
		kind: "Service",
		metadata: {
			name,
			namespace,
			labels: selector,
		},
		spec: {
			type: "ClusterIP",
			selector,
			ports: [{ name: "grpc", port, targetPort }],
		},
	};
}

function connectorFor(name: string): ConnectorDefinition {
	const connector = connectors.find((candidate) => candidate.name === name);
	if (!connector) {
		throw new Error(`Missing connector for ${name}`);
	}
	return connector;
}

function listenerDeploymentName(name: string): string {
	return `${name}-listener`;
}

function connectorDeploymentName(name: string): string {
	return `${name}-connector`;
}

function realServiceName(name: string): string {
	return `${name}-real`;
}

function workloadLabels(
	app: string,
	site: SiteID,
	role: "client" | "connector" | "listener" | "service",
): Record<string, string> {
	return { app, site, role };
}
