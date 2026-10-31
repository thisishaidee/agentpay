import { useCallback, useEffect, useState } from 'react'
import { BRAND } from '@/lib/brand'

/** User-facing pages, in navigation order. */
export const PAGES = ['overview', 'agents', 'leases', 'activity', 'wallet', 'settings', 'deploy'] as const
/** `design` is the internal design-system preview. It is reachable by URL only and is not in the navigation. */
export type PageId = (typeof PAGES)[number] | 'design'

const TITLES: Record<PageId, string> = {
  overview: 'Overview',
  agents: 'Agents',
  leases: 'Leases',
  activity: 'Activity',
  wallet: 'Wallet',
  settings: 'Settings',
  deploy: 'Deploy',
  design: 'Design system',
}

export const pageTitle = (page: PageId): string => TITLES[page]

function readPage(): PageId {
  const value = new URLSearchParams(window.location.search).get('page')
  if (value === 'design') return 'design'
  return (PAGES as readonly string[]).includes(value ?? '') ? (value as PageId) : 'overview'
}

/**
 * Minimal query-string routing (`?page=leases`) so each page has its own URL, back/forward works,
 * and a page can be reloaded or shared. No router dependency is needed for six pages.
 */
export function useRoute(): [PageId, (page: PageId) => void] {
  const [page, setPage] = useState<PageId>(readPage)

  useEffect(() => {
    const onPop = () => setPage(readPage())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    document.title = page === 'overview' ? BRAND.name : `${TITLES[page]} · ${BRAND.name}`
  }, [page])

  const navigate = useCallback((next: PageId) => {
    const url = new URL(window.location.href)
    if (next === 'overview') url.searchParams.delete('page')
    else url.searchParams.set('page', next)
    window.history.pushState(null, '', url)
    setPage(next)
    window.scrollTo({ top: 0 })
  }, [])

  return [page, navigate]
}
