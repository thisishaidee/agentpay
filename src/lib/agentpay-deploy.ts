// Pure deployment-safety logic for the browser deploy page, kept free of
// wagmi/viem so it stays unit-testable. The page calls these before every
// wallet action; the wallet is the only thing that can sign.

export const EXPECTED_DEPLOYER = '0xCB2A51B4D34cC6f5dd574F7b5BfA8260E4201C55'
export const ARC_MAINNET_CHAIN_ID = 5042

export type SafetyCheck =
  | { status: 'idle' | 'checking' }
  | { status: 'ok'; detail: string }
  | { status: 'fail'; detail: string }

export type DeployPhase = 'review' | 'signing' | 'pending' | 'deployed' | 'failed'

export type DeployInputs = {
  phase: DeployPhase
  account: string | undefined
  chainId: number | undefined
  deployerCheck: SafetyCheck
  usdcCheck: SafetyCheck
  gasEstimate: bigint | undefined
}

// True only when a fresh deployment may be started right now.
export function canStartDeployment(inputs: DeployInputs): boolean {
  if (inputs.phase === 'signing' || inputs.phase === 'pending' || inputs.phase === 'deployed') return false
  if (!inputs.account) return false
  if (inputs.chainId !== ARC_MAINNET_CHAIN_ID) return false
  if (!isExpectedDeployer(inputs.account)) return false
  if (inputs.deployerCheck.status !== 'ok') return false
  if (inputs.usdcCheck.status !== 'ok') return false
  if (inputs.gasEstimate === undefined) return false
  return true
}

export function isExpectedDeployer(account: string | undefined): boolean {
  return !!account && account.toLowerCase() === EXPECTED_DEPLOYER.toLowerCase()
}

// True when a wallet/chain change must invalidate previously passed checks.
export function checksStale(inputs: DeployInputs): boolean {
  return (
    !inputs.account ||
    !isExpectedDeployer(inputs.account) ||
    inputs.chainId !== ARC_MAINNET_CHAIN_ID
  )
}

// Outcome of re-checking a submitted transaction. Only a known failure may
// re-enable deployment; an RPC failure leaves the outcome unknown because the
// transaction may still land.
export type ReceiptOutcome =
  | { kind: 'pending' }
  | { kind: 'success'; contractAddress: `0x${string}` }
  | { kind: 'reverted' }
  | { kind: 'unknown'; reason: string }

export function classifyReceiptError(err: unknown): ReceiptOutcome {
  const message = err instanceof Error ? err.message : String(err)
  if (/receipt not found|not found/i.test(message)) return { kind: 'pending' }
  return { kind: 'unknown', reason: message }
}

export function classifyReceiptStatus(status: string, contractAddress: `0x${string}` | undefined): ReceiptOutcome {
  if (status === 'success' && contractAddress) return { kind: 'success', contractAddress }
  if (status === 'success') return { kind: 'unknown', reason: 'Receipt succeeded but has no contract address.' }
  return { kind: 'reverted' }
}
