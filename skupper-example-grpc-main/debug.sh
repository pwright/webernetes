#!/usr/bin/env bash
# Quick diagnostics for the gRPC demo namespaces.

set -o pipefail

namespaces=(grpc-a grpc-b grpc-c)

for ns in "${namespaces[@]}"; do
  echo "=== Namespace: ${ns} ==="
  if ! kubectl get namespace "${ns}" >/dev/null 2>&1; then
    echo "Namespace ${ns} not found, skipping."
    echo
    continue
  fi

  echo "--- Pods (wide) ---"
  kubectl get pods -n "${ns}" -o wide
  echo

  echo "--- Events (recent) ---"
  kubectl get events -n "${ns}" --sort-by=.lastTimestamp | tail -n 20
  echo

  mapfile -t bad_pods < <(kubectl get pods -n "${ns}" --no-headers 2>/dev/null | awk '$3 ~ /CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|CreateContainerConfigError/ {print $1}')

  if ((${#bad_pods[@]} == 0)); then
    echo "No CrashLoop/ImagePull/ConfigError pods detected in ${ns}."
    echo
    continue
  fi

  for pod in "${bad_pods[@]}"; do
    echo "--- Describe: ${pod} ---"
    kubectl describe pod -n "${ns}" "${pod}"
    echo

    echo "--- Logs (current): ${pod} ---"
    kubectl logs -n "${ns}" "${pod}" --all-containers --tail=80
    echo

    echo "--- Logs (previous): ${pod} ---"
    kubectl logs -n "${ns}" "${pod}" --all-containers -p --tail=80
    echo
  done
done
