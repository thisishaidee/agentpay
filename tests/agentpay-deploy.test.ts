// Safety-logic tests for the browser deploy page: account/network switching,
// receipt-polling failures and duplicate-deployment prevention.

import { describe, expect, test } from 'bun:test'
import {
  ARC_MAINNET_CHAIN_ID,
  canStartDeployment,
  checksStale,
  classifyReceiptError,
  classifyReceiptStatus,
  isExpectedDeployer,
  type DeployInputs,
} from '../src/lib/agentpay-deploy'

const DEPLOYER = '0xCB2A51B4D34cC6f5dd574F7b5BfA8260E4201C55'
const ok = { status: 'ok', detail: DEPLOYER } as const

const base = (over: Partial<DeployInputs> = {}): DeployInputs => ({
  phase: 'review',
  account: DEPLOYER,
  chainId: ARC_MAINNET_CHAIN_ID,
  deployerCheck: ok,
  usdcCheck: ok,
  gasEstimate: 500000n,
  ...over,
})

describe('isExpectedDeployer', () => {
  test('accepts checksum and lowercase forms of the deployer', () => {
    expect(isExpectedDeployer(DEPLOYER)).toBe(true)
    expect(isExpectedDeployer(DEPLOYER.toLowerCase())).toBe(true)
  })
  test('rejects other accounts and disconnected wallet', () => {
    expect(isExpectedDeployer('0x0000000000000000000000000000000000000001')).toBe(false)
    expect(isExpectedDeployer(undefined)).toBe(false)
  })
})

describe('account switched after checks passed', () => {
  test('stale checks block deployment and require fresh checks', () => {
    expect(checksStale(base({ account: '0x0000000000000000000000000000000000000001' }))).toBe(true)
    // Even though the old checks still say "ok", the new account must not deploy.
    expect(canStartDeployment(base({ account: '0x0000000000000000000000000000000000000001' }))).toBe(false)
  })
  test('disconnecting the wallet blocks deployment', () => {
    expect(checksStale(base({ account: undefined }))).toBe(true)
    expect(canStartDeployment(base({ account: undefined }))).toBe(false)
  })
})

describe('network switched after checks passed', () => {
  test('a non-mainnet chain blocks deployment', () => {
    expect(checksStale(base({ chainId: 5042002 }))).toBe(true)
    expect(canStartDeployment(base({ chainId: 5042002 }))).toBe(false)
  })
  test('an unknown chain blocks deployment', () => {
    expect(canStartDeployment(base({ chainId: 1 }))).toBe(false)
  })
})

describe('receipt polling failure after submission', () => {
  test('receipt-not-found keeps the transaction pending, deployment stays blocked', () => {
    const out = classifyReceiptError(new Error('Transaction receipt with hash 0xabc not found.'))
    expect(out.kind).toBe('pending')
  })
  test('an RPC error leaves the outcome unknown, deployment stays blocked', () => {
    const out = classifyReceiptError(new Error('HTTP request failed: rate limited'))
    expect(out.kind).toBe('unknown')
    expect((out as { reason: string }).reason).toContain('rate limited')
  })
  test('a reverted receipt is a known failure and may re-enable deployment', () => {
    expect(classifyReceiptStatus('reverted', undefined).kind).toBe('reverted')
  })
  test('a success receipt without a contract address is unknown, not a redeploy', () => {
    expect(classifyReceiptStatus('success', undefined).kind).toBe('unknown')
  })
})

describe('duplicate deployment prevention', () => {
  test('pending phase blocks a second deployment', () => {
    expect(canStartDeployment(base({ phase: 'pending' }))).toBe(false)
  })
  test('signing phase blocks a second deployment', () => {
    expect(canStartDeployment(base({ phase: 'signing' }))).toBe(false)
  })
  test('deployed phase blocks redeployment', () => {
    expect(canStartDeployment(base({ phase: 'deployed' }))).toBe(false)
  })
  test('a known-reverted transaction may return to review', () => {
    // The page only re-enters 'review' after classifyReceiptStatus returns
    // 'reverted'; from then on normal gating applies again.
    expect(canStartDeployment(base({ phase: 'review' }))).toBe(true)
  })
  test('all checks must be ok before deployment', () => {
    expect(canStartDeployment(base({ deployerCheck: { status: 'idle' } }))).toBe(false)
    expect(canStartDeployment(base({ usdcCheck: { status: 'fail', detail: 'x' } }))).toBe(false)
    expect(canStartDeployment(base({ gasEstimate: undefined }))).toBe(false)
  })
})
