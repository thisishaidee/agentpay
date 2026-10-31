import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, FileCheck, Rocket, ShieldAlert, XCircle } from 'lucide-react'
import { arc } from 'viem/chains'
import { createPublicClient, erc20Abi, formatUnits, http, keccak256 } from 'viem'
import { deployContract } from 'viem/actions'
import { useAccount, useConnectorClient, useSwitchChain } from 'wagmi'
import { toast } from 'sonner'
import { Badge, Button, Card, CardHeader, Notice, PageHeader } from '@/components/ui'
import { InfoList, InfoRow } from '@/components/agentpay/Notices'
import { NetworkSwitcher } from '@/components/wallet/NetworkSwitcher'
import artifact from '@/lib/agentpay-artifact.generated.json'
import {
  ARC_MAINNET_CHAIN_ID,
  canStartDeployment,
  checksStale,
  classifyReceiptError,
  classifyReceiptStatus,
  EXPECTED_DEPLOYER as EXPECTED_DEPLOYER_CONST,
  type DeployPhase,
  type ReceiptOutcome,
  type SafetyCheck,
} from '@/lib/agentpay-deploy'

// Expected deployer for mainnet deployments: revalidated on every render and
// again immediately before submission.
const EXPECTED_DEPLOYER = EXPECTED_DEPLOYER_CONST
const ARC_MAINNET_RPC = 'https://rpc.mainnet.arc.io'
// Arc mainnet USDC (per docs.arc.io contract addresses and AgentPayConfig.sol).
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const EXPLORER = 'https://explorer.arc.io'

// A public client pinned to Arc Mainnet: safety reads never depend on the
// connected wallet being on the right chain.
const mainnetClient = createPublicClient({
  chain: arc,
  transport: http(ARC_MAINNET_RPC),
})

function checkText(state: CheckState, fallback: string): string {
  if (state.status === 'ok') return state.detail
  if (state.status === 'fail') return state.detail
  if (state.status === 'checking') return 'Checking...'
  return fallback ? `Not checked (${fallback.slice(0, 18)}...)` : 'Not checked'
}

const ABI = artifact.abi as never[]
const CREATION_BYTECODE = artifact.bytecode as `0x${string}`



type CheckState = SafetyCheck
type Phase = DeployPhase

export function DeployPage() {
  const { address, isConnected, chainId } = useAccount()
  const { data: connectorClient } = useConnectorClient()
  const { switchChain } = useSwitchChain()

  const [phase, setPhase] = useState<Phase>('review')
  const [deployerCheck, setDeployerCheck] = useState<CheckState>({ status: 'idle' })
  const [usdcCheck, setUsdcCheck] = useState<CheckState>({ status: 'idle' })
  const [gasEstimate, setGasEstimate] = useState<bigint | undefined>()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [deployedAddress, setDeployedAddress] = useState<`0x${string}` | undefined>()
  const [postCheck, setPostCheck] = useState<CheckState>({ status: 'idle' })
  const [checkingReceipt, setCheckingReceipt] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()

  const bytecodeHash = useMemo(() => keccak256(CREATION_BYTECODE), [])

  // A wallet account switch or network switch invalidates every passed check:
  // MetaMask can change accounts between the safety checks and submission.
  useEffect(() => {
    if (checksStale({ phase, account: address, chainId, deployerCheck, usdcCheck, gasEstimate })) {
      if (phase === 'signing') setPhase('review')
      if (deployerCheck.status !== 'idle') setDeployerCheck({ status: 'idle' })
      if (usdcCheck.status !== 'idle') setUsdcCheck({ status: 'idle' })
      if (gasEstimate !== undefined) setGasEstimate(undefined)
    }
  }, [address, chainId]) // eslint-disable-line react-hooks/exhaustive-deps

  const onRightChain = chainId === arc.id
  const isDeployer = !!address && address.toLowerCase() === EXPECTED_DEPLOYER.toLowerCase()

  // Run the mainnet safety reads: USDC has code + 6 decimals, gas estimate.
  const runSafetyChecks = useCallback(async () => {
    if (!address) return
    setDeployerCheck({ status: 'checking' })
    setUsdcCheck({ status: 'checking' })
    setGasEstimate(undefined)

    if (!isDeployer) {
      setDeployerCheck({ status: 'fail', detail: `Connected wallet ${address} is not the expected deployer ${EXPECTED_DEPLOYER}.` })
      return
    }
    setDeployerCheck({ status: 'ok', detail: address })

    try {
      const [code, decimals] = await Promise.all([
        mainnetClient.getBytecode({ address: USDC_ADDRESS }),
        mainnetClient.readContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'decimals' }),
      ])
      if (!code || code === '0x') {
        setUsdcCheck({ status: 'fail', detail: 'Arc mainnet USDC has no contract code.' })
        return
      }
      if (decimals !== 6) {
        setUsdcCheck({ status: 'fail', detail: `Arc mainnet USDC reports ${decimals} decimals, expected 6.` })
        return
      }
      setUsdcCheck({ status: 'ok', detail: `${USDC_ADDRESS} (6 decimals, code present)` })

      const gas = await mainnetClient.estimateGas({ account: address, data: CREATION_BYTECODE })
      setGasEstimate(gas)
    } catch (err) {
      setUsdcCheck({ status: 'fail', detail: err instanceof Error ? err.message : 'Safety checks failed.' })
    }
  }, [address, isDeployer])

  // Deploy: wallet-only. The user confirms inside MetaMask; nothing is sent from here.
  const checkReceipt = useCallback(async (hash: `0x${string}`) => {
    setCheckingReceipt(true)
    try {
      const receipt = await mainnetClient.waitForTransactionReceipt({ hash })
      const outcome = classifyReceiptStatus(receipt.status, receipt.contractAddress ?? undefined)
      if (outcome.kind === 'reverted') {
        // Conclusively failed: the only case that allows trying again.
        setPhase('failed')
        setFailure('The deployment transaction reverted on-chain. No contract was created; you may start a new deployment.')
        return
      }
      if (outcome.kind === 'unknown') {
        setFailure(`Receipt unclear: ${outcome.reason}`)
        return
      }
      if (outcome.kind === 'pending') return
      const contractAddress = outcome.contractAddress

      try {
        const runtime = await mainnetClient.getBytecode({ address: contractAddress })
        if (!runtime || runtime === '0x') throw new Error('Deployed address has no code.')
        const [usdc, nextLeaseId] = await Promise.all([
          mainnetClient.readContract({ address: contractAddress, abi: ABI, functionName: 'USDC' }),
          mainnetClient.readContract({ address: contractAddress, abi: ABI, functionName: 'nextLeaseId' }),
        ])
        if (usdc !== USDC_ADDRESS) throw new Error(`Contract USDC() is ${usdc}, expected ${USDC_ADDRESS}.`)
        if (nextLeaseId !== 1n) throw new Error(`nextLeaseId() is ${nextLeaseId}, expected 1.`)
        setDeployedAddress(contractAddress)
        setPostCheck({ status: 'ok', detail: `USDC() and nextLeaseId() verified on ${contractAddress}.` })
        setPhase('deployed')
        toast.success('AgentPay deployed and verified')
      } catch (verifyErr) {
        // The transaction SUCCEEDED; verification is display-level only.
        setDeployedAddress(contractAddress)
        setPostCheck({ status: 'fail', detail: verifyErr instanceof Error ? verifyErr.message : 'Verification failed.' })
        setPhase('deployed')
        toast.warning('Deployed, but post-deploy verification failed. Check the contract on the explorer.')
      }
    } catch (err) {
      const outcome: ReceiptOutcome = classifyReceiptError(err)
      if (outcome.kind === 'pending') {
        toast.info('Receipt not on-chain yet. You can retry the status check.')
      } else if (outcome.kind === 'unknown') {
        // Outcome unknown: never reset to review, never allow a resubmission.
        setFailure(`Could not read the receipt (outcome unknown): ${outcome.reason}. The transaction may still land.`)
        toast.error('Receipt check failed. The transaction may still be mined; retry the status check.')
      }
    } finally {
      setCheckingReceipt(false)
    }
  }, [])

  const deploy = useCallback(async () => {
    if (!connectorClient || !address) return
    // Revalidate the wallet identity and network immediately before submission:
    // MetaMask may have switched accounts or chains since the checks ran.
    if (
      !canStartDeployment({
        phase,
        account: address,
        chainId,
        deployerCheck,
        usdcCheck,
        gasEstimate,
      })
    ) {
      toast.error('Wallet or network changed since the checks. Run the checks again.')
      return
    }
    setPhase('signing')
    try {
      const hash = await deployContract(connectorClient, {
        abi: ABI,
        bytecode: CREATION_BYTECODE,
        chain: arc,
        gas: gasEstimate,
      })
      // Persist the submitted hash immediately: from here the outcome is owned
      // by the chain, and the page must never allow a resubmission while it is
      // unknown.
      setTxHash(hash)
      setPhase('pending')
      toast.info('Transaction submitted. Waiting for the receipt...')
      await checkReceipt(hash)
    } catch (err) {
      // The wallet rejected or the submission failed: no transaction exists.
      setPhase('review')
      toast.error(err instanceof Error ? err.message : 'Deployment failed.')
    }
  }, [connectorClient, address, chainId, phase, deployerCheck, usdcCheck, gasEstimate, checkReceipt])

  // Revalidated on every render, so an account/network switch after the checks
  // re-disables the button immediately.
  const allChecksPass = canStartDeployment({
    phase,
    account: address,
    chainId,
    deployerCheck,
    usdcCheck,
    gasEstimate,
  })

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Deploy"
        title="Deploy AgentPay"
        description="Submit the compiled AgentPay contract to Arc Mainnet with your connected wallet. Nothing is sent until you confirm in MetaMask."
      />

      <Card>
        <CardHeader
          title="1. Wallet and network"
          description="The deployer wallet must match the expected mainnet deployer address."
        />
        {!isConnected ? (
          <Notice tone="info">Connect a wallet to begin.</Notice>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={onRightChain ? 'success' : 'warning'}>
                {onRightChain ? 'Arc Mainnet' : 'Wrong network'}
              </Badge>
              <Badge tone={isDeployer ? 'success' : 'danger'}>
                {isDeployer ? 'Deployer match' : 'Not the deployer wallet'}
              </Badge>
            </div>
            {!onRightChain && (
              <Button variant="primary" onClick={() => switchChain({ chainId: arc.id })}>
                Switch to Arc Mainnet
              </Button>
            )}
            <InfoList>
              <InfoRow label="Connected wallet">{address}</InfoRow>
              <InfoRow label="Expected deployer" hint="Hard-coded in this page.">
                <span className="font-mono text-sm">{EXPECTED_DEPLOYER}</span>
              </InfoRow>
            </InfoList>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="2. Mainnet safety checks"
          description="Reads Arc Mainnet directly. USDC must have code and 6 decimals; gas is estimated from the real creation bytecode."
        />
        <div className="space-y-3">
          <Button variant="secondary" onClick={runSafetyChecks} disabled={!isConnected || !onRightChain}>
            <FileCheck className="size-4" /> Run checks
          </Button>
          <InfoList>
            <InfoRow label="Deployer address">{checkText(deployerCheck, address ?? '')}</InfoRow>
            <InfoRow label="Arc USDC">{checkText(usdcCheck, `${USDC_ADDRESS} (6 decimals expected)`)}</InfoRow>
            <InfoRow label="Gas estimate">
              {gasEstimate
                ? `${gasEstimate.toString()} gas (about ${formatUnits(gasEstimate * 25_000_000_000n, 18)} USDC at 25 gwei)`
                : 'Not checked'}
            </InfoRow>
            <InfoRow label="Creation bytecode">
              <span className="font-mono text-sm">
                {CREATION_BYTECODE.length / 2 - 1} bytes, keccak {bytecodeHash.slice(0, 12)}...
              </span>
            </InfoRow>
          </InfoList>
          {deployerCheck.status === 'fail' && (
            <Notice tone="danger">
              <ShieldAlert className="size-4" /> {deployerCheck.detail}
            </Notice>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Review and confirm"
          description="One creation transaction with the compiled AgentPay bytecode. No constructor arguments: the USDC address is fixed in the contract."
        />
        {phase === 'deployed' && deployedAddress ? (
          <div className="space-y-3">
            <Notice tone="success">
              <CheckCircle2 className="size-4" /> {postCheck.status === 'ok' ? postCheck.detail : 'Deployed.'}
            </Notice>
            <InfoList>
              <InfoRow label="AgentPay address">
                <span className="font-mono text-sm">{deployedAddress}</span>
              </InfoRow>
              <InfoRow label="Transaction">
                {txHash ? (
                  <a className="inline-flex items-center gap-1 underline" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                    {txHash.slice(0, 14)}... <ExternalLink className="size-3.5" />
                  </a>
                ) : '—'}
              </InfoRow>
            </InfoList>
            <a className="inline-flex items-center gap-1 text-sm underline" href={`${EXPLORER}/address/${deployedAddress}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" /> View on Arcscan
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {phase === 'signing' && (
              <Notice tone="info">Waiting for you to confirm in MetaMask, then for the receipt...</Notice>
            )}
            {phase === 'pending' && txHash && (
              <div className="space-y-3">
                <Notice tone="info" title="Deployment submitted, outcome unknown yet">
                  The transaction is on its way. Do not submit another one; check its status instead.
                </Notice>
                <InfoList>
                  <InfoRow label="Transaction">
                    <a className="inline-flex items-center gap-1 underline" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                      {txHash.slice(0, 14)}... <ExternalLink className="size-3.5" />
                    </a>
                  </InfoRow>
                </InfoList>
                <Button variant="secondary" onClick={() => checkReceipt(txHash)} disabled={checkingReceipt}>
                  {checkingReceipt ? 'Checking...' : 'Retry status check'}
                </Button>
              </div>
            )}
            {failure && (
              <Notice tone="danger" title="Deployment outcome">{failure}</Notice>
            )}
            <Button
              variant="primary"
              onClick={deploy}
              disabled={!allChecksPass || phase === 'signing'}
            >
              <Rocket className="size-4" /> {phase === 'signing' ? 'Waiting for wallet...' : 'Deploy to Arc Mainnet'}
            </Button>
            {!allChecksPass && phase !== 'signing' && (
              <Notice tone="warning">Run the checks above and connect the expected deployer wallet on Arc Mainnet first.</Notice>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="What this page will never do"
          description="Safety invariants of this deployment flow."
        />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>It never asks for a private key or recovery phrase: signing happens inside your wallet.</li>
          <li>It refuses to run if the connected wallet is not {EXPECTED_DEPLOYER}.</li>
          <li>It refuses to run on any chain except Arc Mainnet (5042).</li>
          <li>Bytecode is taken from the generated forge artifact, never typed in by hand.</li>
          <li>After deployment it verifies the receipt, deployed code, USDC() and nextLeaseId() == 1.</li>
        </ul>
      </Card>
    </div>
  )
}
