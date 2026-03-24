import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock hooks
vi.mock('@/hooks/useCoverageDashboard', () => ({
  useCoverageDashboard: vi.fn()
}))

vi.mock('@/hooks/useDataTier', () => ({
  useDataTier: vi.fn()
}))

// Mock the CoverageDashboard component
vi.mock('@/components/CoverageDashboard', () => ({
  CoverageDashboard: () => <div data-testid="coverage-dashboard">Coverage Dashboard</div>
}))

// Mock UI components
vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}))

// Mock phosphor icons
vi.mock('@phosphor-icons/react', () => ({
  ArrowsClockwise: ({ className }: { className?: string }) => (
    <svg data-testid="arrows-clockwise-icon" className={className} />
  )
}))

import { useCoverageDashboard } from '@/hooks/useCoverageDashboard'
import { useDataTier } from '@/hooks/useDataTier'
import { CoverageTab } from '../CoverageTab'

describe('CoverageTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useDataTier).mockReturnValue({
      dataTier: 'oss',
      setDataTier: vi.fn()
    })

    vi.mocked(useCoverageDashboard).mockReturnValue({
      snapshot: null,
      loading: true,
      error: null,
      lastRefreshed: null,
      refresh: vi.fn()
    })
  })

  it('renders without crashing', () => {
    render(<CoverageTab />)
    expect(screen.getByTestId('coverage-dashboard')).toBeInTheDocument()
  })

  it('shows refresh button', () => {
    render(<CoverageTab />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('shows "Loading..." initially when lastRefreshed is null', () => {
    render(<CoverageTab />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows last refreshed time when available', () => {
    const recentDate = new Date(Date.now() - 5000) // 5 seconds ago
    vi.mocked(useCoverageDashboard).mockReturnValue({
      snapshot: null,
      loading: false,
      error: null,
      lastRefreshed: recentDate,
      refresh: vi.fn()
    })

    render(<CoverageTab />)
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument()
  })

  it('shows error message when error is set', () => {
    vi.mocked(useCoverageDashboard).mockReturnValue({
      snapshot: null,
      loading: false,
      error: 'Coverage API offline',
      lastRefreshed: null,
      refresh: vi.fn()
    })

    render(<CoverageTab />)
    expect(screen.getByText('Coverage API offline')).toBeInTheDocument()
  })

  it('disables refresh button while loading', () => {
    vi.mocked(useCoverageDashboard).mockReturnValue({
      snapshot: null,
      loading: true,
      error: null,
      lastRefreshed: null,
      refresh: vi.fn()
    })

    render(<CoverageTab />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeDisabled()
  })
})
