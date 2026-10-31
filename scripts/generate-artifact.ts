// generate-artifact - build AgentPay with the pinned Foundry compiler
// (forge build) and extract the deployable artifact (ABI + creation bytecode)
// into src/lib/agentpay-artifact.generated.json for the browser deploy page.
// Always generated from real forge output, never edited by hand.
// Run: bun run artifact

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const artifactPath = path.join(root, 'contracts/out/AgentPay.sol/AgentPay.json')
const outPath = path.join(root, 'src/lib/agentpay-artifact.generated.json')

console.log('forge build...')
execSync('forge build', { stdio: 'inherit', cwd: root })

if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found at ${artifactPath} - did forge build succeed?`)
  process.exit(1)
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as {
  abi: unknown
  bytecode: { object?: string }
}

const bytecode = artifact.bytecode?.object
if (typeof bytecode !== 'string' || !bytecode.startsWith('0x') || bytecode.length < 100) {
  console.error('Artifact has no usable creation bytecode (bytecode.object).')
  process.exit(1)
}

fs.writeFileSync(
  outPath,
  JSON.stringify({ abi: artifact.abi, bytecode }, null, 2) + '\n',
)

console.log(`Wrote ${path.relative(root, outPath)}`)
console.log(`ABI entries: ${(artifact.abi as unknown[]).length}, bytecode: ${bytecode.length - 2} bytes`)
