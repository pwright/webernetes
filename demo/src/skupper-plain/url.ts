export const skupperPlainScenario = "skupper-plain";

export function selectedScenario(search = window.location.search): string | undefined {
	const params = new URLSearchParams(search);
	return params.get("scenario") ?? undefined;
}

export function isSkupperPlainScenario(search?: string): boolean {
	return selectedScenario(search) === skupperPlainScenario;
}
