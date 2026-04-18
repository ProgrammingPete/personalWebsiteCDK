#!/usr/bin/env bash
# CDK Bootstrap Script for Multi-Account Pipeline
#
# Reads account IDs and regions directly from the Configuration Registry
# (lib/config/configuration.ts) so you don't need to pass them manually.
# Bootstraps the pipeline, Beta, and Prod accounts with cross-account trust
# policies so the pipeline account can deploy to target accounts.
#
# Usage:
#   ./scripts/bootstrap.sh [OPTIONS]
#
# Options:
#   --qualifier QUALIFIER    CDK bootstrap qualifier    (default: website)
#   --profile-pipeline NAME  AWS CLI profile for pipeline account
#   --profile-beta NAME      AWS CLI profile for Beta account
#   --profile-prod NAME      AWS CLI profile for Prod account
#   --dry-run                Print what would be run without executing
#   -h, --help               Show this help message
#
# The script bootstraps accounts in this order:
#   1. Pipeline account in the pipeline region
#   2. Pipeline account in us-east-1 (required for ACM certificates used by CloudFront)
#   3. Beta account with trust to the pipeline account
#   4. Prod account with trust to the pipeline account

set -euo pipefail

# ---------- Read config from Configuration Registry ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Reading configuration from lib/config/configuration.ts..."
CONFIG_OUTPUT=$(cd "${PROJECT_ROOT}" && npx ts-node scripts/read-config.ts 2>/dev/null) || {
  echo "ERROR: Failed to read Configuration Registry."
  echo "Make sure 'npm ci' has been run and lib/config/configuration.ts is valid."
  exit 1
}

# Parse KEY=VALUE pairs from the config output
eval "${CONFIG_OUTPUT}"

# ---------- Defaults ----------
QUALIFIER="website"
PROFILE_PIPELINE=""
PROFILE_BETA=""
PROFILE_PROD=""
DRY_RUN=false

# ---------- Usage ----------
usage() {
  cat <<EOF
CDK Bootstrap Script for Multi-Account Pipeline

Reads account IDs and regions from lib/config/configuration.ts automatically.
Bootstraps the CDK toolkit stack in the pipeline, Beta, and Prod accounts
with cross-account trust policies allowing the pipeline account to deploy
to target accounts.

Usage:
  $(basename "$0") [OPTIONS]

Options:
  --qualifier QUALIFIER    CDK bootstrap qualifier    (default: ${QUALIFIER})
  --profile-pipeline NAME  AWS CLI profile for pipeline account
  --profile-beta NAME      AWS CLI profile for Beta account
  --profile-prod NAME      AWS CLI profile for Prod account
  --dry-run                Print what would be run without executing
  -h, --help               Show this help message

Configuration (read from lib/config/configuration.ts):
  Pipeline Account: ${PIPELINE_ACCOUNT} (${PIPELINE_REGION})
  Beta Account:     ${BETA_ACCOUNT} (${BETA_REGION})
  Prod Account:     ${PROD_ACCOUNT} (${PROD_REGION})

To change account IDs or regions, edit lib/config/configuration.ts.

Examples:
  # Bootstrap with config defaults
  $(basename "$0")

  # Bootstrap with AWS CLI profiles for each account
  $(basename "$0") --profile-pipeline pipeline-admin --profile-beta beta-admin --profile-prod prod-admin

  # Preview commands without executing
  $(basename "$0") --dry-run
EOF
  exit 0
}

# ---------- Parse arguments ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --qualifier)        QUALIFIER="$2";        shift 2 ;;
    --profile-pipeline) PROFILE_PIPELINE="$2"; shift 2 ;;
    --profile-beta)     PROFILE_BETA="$2";     shift 2 ;;
    --profile-prod)     PROFILE_PROD="$2";     shift 2 ;;
    --dry-run)          DRY_RUN=true;          shift ;;
    -h|--help)          usage ;;
    *)
      echo "Error: Unknown option '$1'"
      echo "Run '$(basename "$0") --help' for usage information."
      exit 1
      ;;
  esac
done

# ---------- Helpers ----------
log() {
  echo ""
  echo "============================================================"
  echo "  $1"
  echo "============================================================"
}

build_profile_flag() {
  local profile="$1"
  if [[ -n "${profile}" ]]; then
    echo "--profile ${profile}"
  fi
}

bootstrap() {
  local account="$1"
  local region="$2"
  local trust_account="${3:-}"
  local profile_flag="$4"

  local trust_flag=""
  if [[ -n "${trust_account}" ]]; then
    trust_flag="--trust ${trust_account}"
  fi

  local cmd="npx cdk bootstrap aws://${account}/${region} --qualifier ${QUALIFIER} --toolkit-stack-name CDKToolkit-${QUALIFIER} ${trust_flag} --cloudformation-execution-policies arn:aws:iam::aws:policy/AdministratorAccess ${profile_flag}"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "  [dry-run] ${cmd}"
    return
  fi

  # shellcheck disable=SC2086
  npx cdk bootstrap "aws://${account}/${region}" \
    --qualifier "${QUALIFIER}" \
    --toolkit-stack-name "CDKToolkit-${QUALIFIER}" \
    ${trust_flag} \
    --cloudformation-execution-policies "arn:aws:iam::aws:policy/AdministratorAccess" \
    ${profile_flag}
}

# ---------- Summary ----------
echo ""
echo "CDK Bootstrap Configuration"
echo "----------------------------"
echo "  Qualifier:        ${QUALIFIER}"
echo "  Pipeline Account: ${PIPELINE_ACCOUNT} (${PIPELINE_REGION})"
echo "  Beta Account:     ${BETA_ACCOUNT} (${BETA_REGION})"
echo "  Prod Account:     ${PROD_ACCOUNT} (${PROD_REGION})"
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "  Mode:             DRY RUN (no changes will be made)"
fi
echo ""

# ---------- 1. Bootstrap pipeline account (primary region) ----------
log "Bootstrapping Pipeline account ${PIPELINE_ACCOUNT} in ${PIPELINE_REGION}"
bootstrap "${PIPELINE_ACCOUNT}" "${PIPELINE_REGION}" "" "$(build_profile_flag "${PROFILE_PIPELINE}")"

# ---------- 2. Bootstrap pipeline account in us-east-1 (ACM for CloudFront) ----------
if [[ "${PIPELINE_REGION}" != "us-east-1" ]]; then
  log "Bootstrapping Pipeline account ${PIPELINE_ACCOUNT} in us-east-1 (ACM certificates for CloudFront)"
  bootstrap "${PIPELINE_ACCOUNT}" "us-east-1" "" "$(build_profile_flag "${PROFILE_PIPELINE}")"
fi

# ---------- 3. Bootstrap Beta account with trust to pipeline ----------
log "Bootstrapping Beta account ${BETA_ACCOUNT} in ${BETA_REGION} (trust → ${PIPELINE_ACCOUNT})"
bootstrap "${BETA_ACCOUNT}" "${BETA_REGION}" "${PIPELINE_ACCOUNT}" "$(build_profile_flag "${PROFILE_BETA}")"

# Bootstrap Beta in us-east-1 if the Beta region is not already us-east-1
if [[ "${BETA_REGION}" != "us-east-1" ]]; then
  log "Bootstrapping Beta account ${BETA_ACCOUNT} in us-east-1 (ACM certificates for CloudFront, trust → ${PIPELINE_ACCOUNT})"
  bootstrap "${BETA_ACCOUNT}" "us-east-1" "${PIPELINE_ACCOUNT}" "$(build_profile_flag "${PROFILE_BETA}")"
fi

# ---------- 4. Bootstrap Prod account with trust to pipeline ----------
log "Bootstrapping Prod account ${PROD_ACCOUNT} in ${PROD_REGION} (trust → ${PIPELINE_ACCOUNT})"
bootstrap "${PROD_ACCOUNT}" "${PROD_REGION}" "${PIPELINE_ACCOUNT}" "$(build_profile_flag "${PROFILE_PROD}")"

# Bootstrap Prod in us-east-1 if the Prod region is not already us-east-1
if [[ "${PROD_REGION}" != "us-east-1" ]]; then
  log "Bootstrapping Prod account ${PROD_ACCOUNT} in us-east-1 (ACM certificates for CloudFront, trust → ${PIPELINE_ACCOUNT})"
  bootstrap "${PROD_ACCOUNT}" "us-east-1" "${PIPELINE_ACCOUNT}" "$(build_profile_flag "${PROFILE_PROD}")"
fi

# ---------- Done ----------
log "Bootstrap complete!"
echo ""
echo "All accounts have been bootstrapped with qualifier '${QUALIFIER}'."
echo ""
echo "Next steps:"
echo "  1. Verify the CDKToolkit-${QUALIFIER} stack exists in each account/region"
echo "  2. Run 'npx cdk synth' to synthesize the pipeline stack"
echo "  3. Run 'npx cdk deploy' to deploy the pipeline"
echo ""
