export const skupperGrpcScenario = "skupper-grpc";

export function isSkupperGrpcScenario(search = window.location.search): boolean {
	const params = new URLSearchParams(search);
	return params.get("scenario") === skupperGrpcScenario;
}
