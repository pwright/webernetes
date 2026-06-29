import { useRef, useState } from "react";
import * as w8s from "webernetes";

import { Cluster } from "./components/cluster";
import { Header } from "./components/header";
import { RequestOverlay } from "./components/request-overlay";
import { ResourcesTabs } from "./components/resources-tabs";
import { distance, getHeader, healthCheckHeader, idFor, kubeletIdForNodeName } from "./helpers";
import { useCluster, usePauseClusterWhenPageInactive } from "./hooks";
import { SkupperGrpcPanel } from "./skupper-grpc/panel";
import { setupSkupperGrpc } from "./skupper-grpc/setup";
import { isSkupperGrpcScenario } from "./skupper-grpc/url";
import { SkupperPlainPanel } from "./skupper-plain/panel";
import { setupSkupperPlain } from "./skupper-plain/setup";
import { isSkupperPlainScenario } from "./skupper-plain/url";
import { setup } from "./setup";

type PreNetworkEvent = w8s.PreNetworkRequestEvent | w8s.PreNetworkResponseEvent;
const containerTerminationLatencyMs = 2000;

const demoClusterOptions: w8s.ClusterOptions = {
	latencyProvider: w8s.newLatencyProvider({
		clusterNetworkRequestLatency: (event) => getLatency("request", event),
		clusterNetworkResponseLatency: (event) => getLatency("response", event),
		containerTerminationLatency: () => containerTerminationLatencyMs,
	}),
};

const skupperPlainClusterOptions: w8s.ClusterOptions = {
	...demoClusterOptions,
	nodeNames: ["west", "east"],
};
const skupperGrpcClusterOptions: w8s.ClusterOptions = {
	...demoClusterOptions,
	nodeNames: ["grpc-a", "grpc-b", "grpc-c"],
};
const skupperPlainNodeOrder = ["west", "east"] as const;
const skupperPlainNamespaces = ["west", "east"] as const;
const skupperGrpcNodeOrder = ["grpc-a", "grpc-b", "grpc-c"] as const;
const skupperGrpcNamespaces = ["grpc-a", "grpc-b", "grpc-c"] as const;

export function App() {
	const skupperPlain = isSkupperPlainScenario();
	const skupperGrpc = isSkupperGrpcScenario();
	const setupCluster = skupperGrpc ? setupSkupperGrpc : skupperPlain ? setupSkupperPlain : setup;
	const { cluster, reset } = useCluster(
		setupCluster,
		skupperGrpc
			? skupperGrpcClusterOptions
			: skupperPlain
				? skupperPlainClusterOptions
				: demoClusterOptions,
	);
	usePauseClusterWhenPageInactive(cluster);
	const [namespace, setNamespace] = useState<string | undefined>(
		skupperPlain || skupperGrpc ? undefined : "default",
	);
	const [highlightedPodIds, setHighlightedPodIds] = useState<Set<string>>(new Set());
	const requestLayerRef = useRef<HTMLDivElement>(null);

	function changeNamespace(value: string | undefined) {
		setNamespace(value);
		setHighlightedPodIds(new Set());
	}

	if (!cluster) {
		return <div className="text-muted text-sm">Booting simulated Kubernetes cluster...</div>;
	}

	return (
		<div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
			<Header
				cluster={cluster}
				namespace={namespace}
				onNamespaceChange={changeNamespace}
				onReset={reset}
			/>
			<main className="space-y-6">
				{skupperPlain ? <SkupperPlainPanel /> : undefined}
				{skupperGrpc ? <SkupperGrpcPanel /> : undefined}
				<div ref={requestLayerRef} className="relative space-y-6">
					<Cluster
						cluster={cluster}
						highlightedPodIds={highlightedPodIds}
						namespace={namespace}
						nodeOrder={
							skupperGrpc ? skupperGrpcNodeOrder : skupperPlain ? skupperPlainNodeOrder : undefined
						}
						visibleNamespaces={
							skupperGrpc && namespace === undefined
								? skupperGrpcNamespaces
								: skupperPlain && namespace === undefined
									? skupperPlainNamespaces
									: undefined
						}
					/>
					<RequestOverlay cluster={cluster} containerRef={requestLayerRef} namespace={namespace} />
				</div>
				<ResourcesTabs
					cluster={cluster}
					namespace={namespace}
					onHighlightedPodIdsChange={setHighlightedPodIds}
				/>
			</main>
		</div>
	);
}

function getLatency(direction: "request" | "response", event: PreNetworkEvent): number {
	const [fromId, toId] = endpoints(direction, event);
	if (!fromId || !toId || fromId === toId || typeof document === "undefined") {
		return 0;
	}
	const from = document.getElementById(fromId);
	const to = document.getElementById(toId);
	if (!from || !to) {
		return 0;
	}
	const px = distance(from, to);
	if (px === 0) {
		return 0;
	}
	return (px / dotSpeed()) * 1000;
}

function endpoints(
	direction: "request" | "response",
	event: PreNetworkEvent,
): [string | undefined, string | undefined] {
	const { chain } = event;
	const ids = chain
		.map((hop) => (hop.type === "external" ? undefined : idFor(hop.resource)))
		.filter((id): id is string => id !== undefined);
	const pod = isHealthCheckRequest(event) ? podForHealthCheck(chain) : undefined;
	if (pod) {
		const podId = idFor(pod);
		const kubeletId = kubeletIdForNodeName(pod.spec?.nodeName ?? "");
		return direction === "request" ? [kubeletId, podId] : [podId, kubeletId];
	}
	return [ids[0], ids.at(-1)];
}

function isHealthCheckRequest(event: PreNetworkEvent): boolean {
	return getHeader(event.request.header, healthCheckHeader) !== undefined;
}

function podForHealthCheck(chain: readonly w8s.NetworkHop[]): w8s.V1Pod | undefined {
	return chain.find(
		(hop): hop is Extract<w8s.NetworkHop, { type: "pod" }> =>
			hop.type === "pod" && hop.resource.spec?.nodeName !== undefined,
	)?.resource;
}

function dotSpeed(): number {
	const min = 245;
	const max = 315;
	return min + Math.random() * (max - min);
}
