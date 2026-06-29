import { useMemo } from "react";
import * as w8s from "webernetes";

import { idFor, sortByName } from "../helpers";
import { useInformer } from "../hooks";
import { Node } from "./node";

export function Cluster({
	cluster,
	highlightedPodIds,
	namespace,
	nodeOrder,
	visibleNamespaces,
}: {
	cluster: w8s.Cluster;
	highlightedPodIds: ReadonlySet<string>;
	namespace: string | undefined;
	nodeOrder?: readonly string[];
	visibleNamespaces?: readonly string[];
}) {
	const sortNodes = useMemo(
		() => (nodeOrder ? sortByNodeOrder(nodeOrder) : sortByName),
		[nodeOrder],
	);
	const nodes = useInformer({
		cluster,
		resource: "nodes",
		sort: sortNodes,
	});

	return (
		<div className="grid gap-4 lg:grid-cols-3">
			{nodes.map((node) => (
				<Node
					key={idFor(node)}
					cluster={cluster}
					highlightedPodIds={highlightedPodIds}
					namespace={namespace}
					node={node}
					visibleNamespaces={visibleNamespaces}
				/>
			))}
		</div>
	);
}

function sortByNodeOrder(order: readonly string[]) {
	const orderByName = new Map(order.map((name, index) => [name, index]));
	return (nodes: w8s.V1Node[]): w8s.V1Node[] =>
		[...nodes].toSorted((left, right) => {
			const leftName = left.metadata?.name ?? "";
			const rightName = right.metadata?.name ?? "";
			const leftOrder = orderByName.get(leftName) ?? Number.MAX_SAFE_INTEGER;
			const rightOrder = orderByName.get(rightName) ?? Number.MAX_SAFE_INTEGER;
			return leftOrder - rightOrder || leftName.localeCompare(rightName);
		});
}
