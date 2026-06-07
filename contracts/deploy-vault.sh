#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# One-shot HypeIndexVault deploy + openVault helper (ValueChain testnet 138565).
#
#   cp contracts/deploy-vault.env.example contracts/.env.deploy   # then fill it
#   ./contracts/deploy-vault.sh check
#   ./contracts/deploy-vault.sh deploy
#   ./contracts/deploy-vault.sh open-vault <indexId(bytes32)> <creator(address)>
#
# Requires Foundry (forge + cast): https://getfoundry.sh
# Reads env from contracts/.env.deploy (override with ENV_FILE=...).
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
ENV_FILE="${ENV_FILE:-$CONTRACTS/.env.deploy}"

die()  { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool '$1' — install Foundry: https://getfoundry.sh"; }

load_env() {
  [ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE
  → cp $CONTRACTS/deploy-vault.env.example $ENV_FILE   and fill it in first."
  set -a; . "$ENV_FILE"; set +a
}

require_vars() {
  local missing=()
  for v in "$@"; do [ -n "${!v:-}" ] || missing+=("$v"); done
  [ ${#missing[@]} -eq 0 ] || die "missing required vars in $ENV_FILE: ${missing[*]}"
}

# Set KEY=VALUE in the env file (replace in place if present, append otherwise).
set_env() {
  local key="$1" val="$2" tmp
  if grep -qE "^${key}=" "$ENV_FILE"; then
    tmp="$(mktemp)"; sed "s|^${key}=.*|${key}=${val}|" "$ENV_FILE" >"$tmp" && mv "$tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

cmd_check() {
  need cast; load_env
  require_vars SSI_RPC_URL DEPLOYER_PK VAULT_SIGNER VAULT_KEEPER VAULT_GUARDIAN
  echo "• env file : $ENV_FILE"
  echo "• rpc      : $SSI_RPC_URL"
  local cid; cid="$(cast chain-id --rpc-url "$SSI_RPC_URL" 2>/dev/null)" || die "RPC unreachable: $SSI_RPC_URL"
  echo "• chainId  : $cid$( [ "$cid" = "138565" ] || echo '   ⚠ expected 138565 (ValueChain testnet)' )"
  local addr bal
  addr="$(cast wallet address --private-key "$DEPLOYER_PK" 2>/dev/null)" || die "bad DEPLOYER_PK"
  bal="$(cast balance "$addr" --rpc-url "$SSI_RPC_URL" 2>/dev/null || echo 0)"
  echo "• deployer : $addr"
  echo "• balance  : ${bal} wei$( [ "$bal" != "0" ] || echo '   ⚠ fund this wallet with VAL for gas' )"
  echo "OK — ready to deploy."
}

cmd_deploy() {
  need forge; need cast; load_env
  require_vars SSI_RPC_URL DEPLOYER_PK VAULT_SIGNER VAULT_KEEPER VAULT_GUARDIAN
  cd "$CONTRACTS"
  echo "→ forge build"; forge build >/dev/null || die "forge build failed"
  echo "→ broadcasting deploy to $SSI_RPC_URL ..."
  local out
  # Deploy.s.sol reads DEPLOYER_PK/VAULT_* from env (exported by load_env) and
  # broadcasts via vm.startBroadcast(pk).
  out="$(forge script script/Deploy.s.sol --rpc-url "$SSI_RPC_URL" --broadcast -vvv 2>&1)" \
    || { echo "$out" | tail -30; die "forge script failed"; }
  echo "$out" | grep -E 'HypeIndexVault:|MockUSDC:' || true
  local vault usdc
  vault="$(echo "$out" | grep -oE 'HypeIndexVault: 0x[0-9a-fA-F]{40}' | tail -1 | awk '{print $2}')"
  usdc="$(echo "$out"  | grep -oE 'MockUSDC: 0x[0-9a-fA-F]{40}'       | tail -1 | awk '{print $2}')"
  [ -n "$vault" ] || die "could not parse HypeIndexVault address from forge output"
  [ -n "$usdc" ]  || usdc="${USDC_ADDRESS:-}"
  echo ""
  echo "✅ Deployed:"
  echo "   HypeIndexVault = $vault"
  echo "   USDC           = ${usdc:-<USDC_ADDRESS from env>}"
  set_env NEXT_PUBLIC_HYPE_VAULT_ADDRESS "$vault"
  set_env NEXT_PUBLIC_USDC_ADDRESS "$usdc"
  set_env VAULT_ADDRESS "$vault"
  set_env VAULT_USDC_ADDRESS "$usdc"
  echo "   (written back into $ENV_FILE)"
  echo ""
  echo "NEXT STEPS"
  echo "  1) Put these in the FRONTEND root .env, then redeploy the frontend:"
  echo "       NEXT_PUBLIC_HYPE_VAULT_ADDRESS=$vault"
  echo "       NEXT_PUBLIC_USDC_ADDRESS=$usdc"
  echo "  2) Open a vault per published index (else requestDeposit reverts VaultInactive):"
  echo "       ./contracts/deploy-vault.sh open-vault <on_chain_index_id> <creator_address>"
  echo "  3) Run the keeper/NAV-signer (agent-service/src/vault/README.md) with the VAULT_* vars."
}

cmd_open_vault() {
  need cast; load_env
  local index_id="${1:-}" creator="${2:-}"
  { [ -n "$index_id" ] && [ -n "$creator" ]; } || die "usage: $0 open-vault <indexId(bytes32)> <creator(address)>"
  require_vars SSI_RPC_URL VAULT_ADDRESS
  local keeper_pk="${VAULT_KEEPER_PRIVATE_KEY:-${DEPLOYER_PK:-}}"
  [ -n "$keeper_pk" ] || die "need VAULT_KEEPER_PRIVATE_KEY (or DEPLOYER_PK) to send openVault"
  echo "→ openVault($index_id, $creator) on $VAULT_ADDRESS"
  cast send --rpc-url "$SSI_RPC_URL" --private-key "$keeper_pk" \
    "$VAULT_ADDRESS" "openVault(bytes32,address)" "$index_id" "$creator"
  echo "✅ vault opened for $index_id"
}

case "${1:-}" in
  check)      cmd_check ;;
  deploy)     cmd_deploy ;;
  open-vault) shift; cmd_open_vault "$@" ;;
  *) echo "Usage: $0 {check | deploy | open-vault <indexId> <creator>}"; exit 1 ;;
esac
