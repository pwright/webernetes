import * as w8s from "webernetes";

import {
	SkupperPlainBackendImage,
	SkupperPlainClientImage,
	SkupperPlainConnectorImage,
	SkupperPlainFrontendImage,
	SkupperPlainListenerImage,
} from "./images";

export async function setupSkupperPlain(cluster: w8s.Cluster): Promise<void> {
	cluster.registerImage(SkupperPlainFrontendImage);
	cluster.registerImage(SkupperPlainBackendImage);
	cluster.registerImage(SkupperPlainListenerImage);
	cluster.registerImage(SkupperPlainConnectorImage);
	cluster.registerImage(SkupperPlainClientImage);

	await cluster.apply(skupperPlainResources());
}

export function skupperPlainResources(): w8s.ClusterApplyResource[] {
	return [
		namespace("west"),
		namespace("east"),
		deployment({
			namespace: "west",
			name: "frontend",
			labels: { app: "frontend", site: "west", role: "frontend" },
			nodeName: "west",
			containers: [
				{
					name: "frontend",
					image: "demo/skupper-plain-frontend:1.0",
					ports: [{ name: "http", containerPort: 8080 }],
				},
			],
		}),
		service({
			namespace: "west",
			name: "frontend",
			selector: { app: "frontend" },
		}),
		deployment({
			namespace: "west",
			name: "backend-listener",
			labels: { app: "backend-listener", site: "west", role: "listener" },
			nodeName: "west",
			containers: [
				{
					name: "listener",
					image: "demo/skupper-plain-listener:1.0",
					ports: [{ name: "http", containerPort: 8080 }],
					env: [
						{ name: "SITE_ID", value: "west" },
						{ name: "ROUTING_KEY", value: "backend" },
						{ name: "CONNECTOR_URL", value: "http://backend-connector.east.svc.cluster.local" },
					],
				},
			],
		}),
		service({
			namespace: "west",
			name: "backend",
			selector: { app: "backend-listener" },
		}),
		deployment({
			namespace: "west",
			name: "client",
			labels: { app: "client", site: "west", role: "client" },
			nodeName: "west",
			containers: [
				{
					name: "client",
					image: "demo/skupper-plain-client:1.0",
					env: [{ name: "REQUESTS_PER_SECOND", value: "1" }],
				},
			],
		}),
		deployment({
			namespace: "east",
			name: "backend",
			labels: { app: "backend", site: "east", role: "backend" },
			nodeName: "east",
			containers: [
				{
					name: "backend",
					image: "demo/skupper-plain-backend:1.0",
					ports: [{ name: "http", containerPort: 8080 }],
				},
			],
		}),
		service({
			namespace: "east",
			name: "backend",
			selector: { app: "backend" },
		}),
		deployment({
			namespace: "east",
			name: "backend-connector",
			labels: { app: "backend-connector", site: "east", role: "connector" },
			nodeName: "east",
			containers: [
				{
					name: "connector",
					image: "demo/skupper-plain-connector:1.0",
					ports: [{ name: "http", containerPort: 8080 }],
					env: [
						{ name: "SITE_ID", value: "east" },
						{ name: "ROUTING_KEY", value: "backend" },
						{ name: "TARGET_URL", value: "http://backend.east.svc.cluster.local" },
					],
				},
			],
		}),
		service({
			namespace: "east",
			name: "backend-connector",
			selector: { app: "backend-connector" },
		}),
	];
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
	nodeName?: string;
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
	selector,
}: {
	name: string;
	namespace: string;
	selector: Record<string, string>;
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
			ports: [{ name: "http", port: 80, targetPort: 8080 }],
		},
	};
}
