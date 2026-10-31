import { Activity, Bot, KeyRound, LayoutDashboard, Rocket, Settings, Wallet } from 'lucide-react'
import { AppShell, type NavItem } from '@/components/layout/AppShell'
import { WalletButton } from '@/components/layout/WalletButton'
import { WalletEvents } from '@/components/wallet/WalletEvents'
import { WalletModalProvider } from '@/components/wallet/WalletModalProvider'
import { DesignPreview } from '@/design-system/DesignPreview'
import { useRoute, type PageId } from '@/lib/route'
import { ActivityPage } from '@/pages/ActivityPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { LeasesPage } from '@/pages/LeasesPage'
import { DeployPage } from '@/pages/DeployPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WalletPage } from '@/pages/WalletPage'

/** User-facing navigation. The design-system preview is internal: open it with ?page=design. */
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'leases', label: 'Leases', icon: KeyRound },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'deploy', label: 'Deploy', icon: Rocket },
]

function renderPage(page: PageId, navigate: (page: PageId) => void) {
  switch (page) {
    case 'agents':
      return <AgentsPage />
    case 'leases':
      return <LeasesPage />
    case 'activity':
      return <ActivityPage />
    case 'wallet':
      return <WalletPage />
    case 'deploy':
      return <DeployPage />
    case 'settings':
      return <SettingsPage />
    case 'design':
      return <DesignPreview />
    default:
      return <OverviewPage onNavigate={navigate} />
  }
}

export default function App() {
  const [page, navigate] = useRoute()

  return (
    <WalletModalProvider>
      <WalletEvents />
      <AppShell
        nav={NAV}
        activeId={page}
        onNavigate={(id) => navigate(id as PageId)}
        topBarActions={(tone) => <WalletButton tone={tone} />}
      >
        {renderPage(page, navigate)}
      </AppShell>
    </WalletModalProvider>
  )
}
