import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { DataPipelineStatus, DataPipelineStatusProps } from '../DataPipelineStatus'

// Mock UI components
vi.mock('@public-records/ui/badge', () => ({
  Badge: ({
    children,
    variant,
    className
  }: {
    children: ReactNode
    variant?: string
    className?: string
  }) => (
    <span data-testid="badge" data-variant={variant} className={className}>
      {children}
    </span>
  )
}))

vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    size,
    variant,
    className
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    size?: string
    variant?: string
    className?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-size={size}
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="card-description">{children}</p>
  ),
  CardHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h3 data-testid="card-title" className={className}>
      {children}
    </h3>
  )
}))

vi.mock('@public-records/ui/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid="progress" data-value={value} className={className} />
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  Database: ({ className }: { className?: string }) => (
    <span data-testid="database-icon" className={className} />
  ),
  CheckCircle: ({ className }: { className?: string }) => (
    <span data-testid="check-icon" className={className} />
  ),
  XCircle: ({ className }: { className?: string }) => (
    <span data-testid="x-icon" className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span data-testid="clock-icon" className={className} />
  ),
  ArrowClockwise: ({ className }: { className?: string }) => (
    <span data-testid="refresh-icon" className={className} />
  ),
  Warning: ({ className }: { className?: string }) => (
    <span data-testid="warning-icon" className={className} />
  ),
  Play: ({ className }: { className?: string }) => (
    <span data-testid="play-icon" className={className} />
  ),
  Pause: ({ className }: { className?: string }) => (
    <span data-testid="pause-icon" className={className} />
  )
}))

// Mock feature flags
vi.mock('@/lib/config/dataPipeline', () => ({
  featureFlags: {
    useMockData: false
  }
}))

describe('DataPipelineStatus', () => {
  const defaultProps: DataPipelineStatusProps = {
    loading: false,
    error: null,
    lastUpdate: '2024-01-15T10:30:00.000Z',
    schedulerStatus: {
      running: true,
      lastIngestionRun: '2024-01-15T08:00:00.000Z',
      lastEnrichmentRun: '2024-01-15T09:00:00.000Z',
      lastRefreshRun: '2024-01-15T10:00:00.000Z',
      totalProspectsProcessed: 1250,
      totalErrors: 5
    },
    onRefresh: vi.fn(),
    onStartScheduler: vi.fn(),
    onStopScheduler: vi.fn(),
    onTriggerIngestion: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the card with title', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByTestId('card-title')).toHaveTextContent('Data Pipeline Status')
    })

    it('renders the database icon', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getAllByTestId('database-icon').length).toBeGreaterThan(0)
    })

    it('renders description for real data mode', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByTestId('card-description')).toHaveTextContent(
        'Real-time data ingestion and enrichment'
      )
    })
  })

  describe('status badges', () => {
    it('shows loading badge when loading', () => {
      render(<DataPipelineStatus {...defaultProps} loading={true} />)

      const badges = screen.getAllByTestId('badge')
      const loadingBadge = badges.find((b) => b.textContent?.includes('Loading'))
      expect(loadingBadge).toBeInTheDocument()
    })

    it('shows error badge when error exists', () => {
      render(<DataPipelineStatus {...defaultProps} error="Connection failed" />)

      const badges = screen.getAllByTestId('badge')
      const errorBadge = badges.find((b) => b.textContent?.includes('Error'))
      expect(errorBadge).toBeInTheDocument()
    })

    it('shows active badge when scheduler is running', () => {
      render(<DataPipelineStatus {...defaultProps} />)

      const badges = screen.getAllByTestId('badge')
      const activeBadge = badges.find((b) => b.textContent?.includes('Active'))
      expect(activeBadge).toBeInTheDocument()
    })

    it('shows paused badge when scheduler is not running', () => {
      const props = {
        ...defaultProps,
        schedulerStatus: { ...defaultProps.schedulerStatus!, running: false }
      }
      render(<DataPipelineStatus {...props} />)

      const badges = screen.getAllByTestId('badge')
      const pausedBadge = badges.find((b) => b.textContent?.includes('Paused'))
      expect(pausedBadge).toBeInTheDocument()
    })
  })

  describe('error display', () => {
    it('displays error message when error exists', () => {
      render(<DataPipelineStatus {...defaultProps} error="Database connection failed" />)
      expect(screen.getByText('Database connection failed')).toBeInTheDocument()
    })

    it('shows pipeline error label', () => {
      render(<DataPipelineStatus {...defaultProps} error="Test error" />)
      expect(screen.getByText('Pipeline Error')).toBeInTheDocument()
    })

    it('shows warning icon for errors', () => {
      render(<DataPipelineStatus {...defaultProps} error="Test error" />)
      expect(screen.getByTestId('warning-icon')).toBeInTheDocument()
    })
  })

  describe('relative time formatting', () => {
    it('formats recent time as "Just now"', () => {
      const now = new Date().toISOString()
      render(<DataPipelineStatus {...defaultProps} lastUpdate={now} />)
      expect(screen.getByText('Just now')).toBeInTheDocument()
    })

    it('displays "Never" for undefined dates', () => {
      const props = {
        ...defaultProps,
        schedulerStatus: {
          ...defaultProps.schedulerStatus!,
          lastIngestionRun: undefined
        }
      }
      render(<DataPipelineStatus {...props} />)
      expect(screen.getAllByText('Never').length).toBeGreaterThan(0)
    })
  })

  describe('statistics', () => {
    it('displays total prospects processed', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Prospects Processed')).toBeInTheDocument()
      expect(screen.getByText('1,250')).toBeInTheDocument()
    })

    it('displays error count when errors exist', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Errors')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('shows progress bar when errors exist', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByTestId('progress')).toBeInTheDocument()
    })

    it('does not show error stats when no errors', () => {
      const props = {
        ...defaultProps,
        schedulerStatus: { ...defaultProps.schedulerStatus!, totalErrors: 0 }
      }
      render(<DataPipelineStatus {...props} />)
      expect(screen.queryByText('Errors')).not.toBeInTheDocument()
    })
  })

  describe('action buttons', () => {
    it('renders refresh button', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Refresh')).toBeInTheDocument()
    })

    it('calls onRefresh when refresh button is clicked', async () => {
      const onRefresh = vi.fn()
      render(<DataPipelineStatus {...defaultProps} onRefresh={onRefresh} />)

      await userEvent.click(screen.getByText('Refresh'))
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })

    it('disables refresh button when loading', () => {
      render(<DataPipelineStatus {...defaultProps} loading={true} />)
      expect(screen.getByText('Refresh').closest('button')).toBeDisabled()
    })

    it('shows stop button when scheduler is running', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Stop')).toBeInTheDocument()
    })

    it('calls onStopScheduler when stop button is clicked', async () => {
      const onStopScheduler = vi.fn()
      render(<DataPipelineStatus {...defaultProps} onStopScheduler={onStopScheduler} />)

      await userEvent.click(screen.getByText('Stop'))
      expect(onStopScheduler).toHaveBeenCalledTimes(1)
    })

    it('shows start button when scheduler is not running', () => {
      const props = {
        ...defaultProps,
        schedulerStatus: { ...defaultProps.schedulerStatus!, running: false }
      }
      render(<DataPipelineStatus {...props} />)
      expect(screen.getByText('Start')).toBeInTheDocument()
    })

    it('calls onStartScheduler when start button is clicked', async () => {
      const onStartScheduler = vi.fn()
      const props = {
        ...defaultProps,
        schedulerStatus: { ...defaultProps.schedulerStatus!, running: false },
        onStartScheduler
      }
      render(<DataPipelineStatus {...props} />)

      await userEvent.click(screen.getByText('Start'))
      expect(onStartScheduler).toHaveBeenCalledTimes(1)
    })

    it('shows ingest button', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Ingest')).toBeInTheDocument()
    })

    it('calls onTriggerIngestion when ingest button is clicked', async () => {
      const onTriggerIngestion = vi.fn()
      render(<DataPipelineStatus {...defaultProps} onTriggerIngestion={onTriggerIngestion} />)

      await userEvent.click(screen.getByText('Ingest'))
      expect(onTriggerIngestion).toHaveBeenCalledTimes(1)
    })
  })

  describe('null scheduler status', () => {
    it('handles null scheduler status gracefully', () => {
      const props = {
        ...defaultProps,
        schedulerStatus: null
      }
      render(<DataPipelineStatus {...props} />)
      expect(screen.getByTestId('card')).toBeInTheDocument()
    })
  })

  describe('last update display', () => {
    it('shows last update time', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Last Update')).toBeInTheDocument()
    })

    it('shows last ingestion time', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Last Ingestion')).toBeInTheDocument()
    })

    it('shows last enrichment time', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Last Enrichment')).toBeInTheDocument()
    })

    it('shows last refresh time', () => {
      render(<DataPipelineStatus {...defaultProps} />)
      expect(screen.getByText('Last Refresh')).toBeInTheDocument()
    })
  })
})

describe('DataPipelineStatus without demo data mode', () => {
  it('does not show mock data badge (demo data is opt-in only)', () => {
    const props: DataPipelineStatusProps = {
      loading: false,
      error: null,
      lastUpdate: null,
      schedulerStatus: null,
      onRefresh: vi.fn()
    }

    render(<DataPipelineStatus {...props} />)

    const badges = screen.queryAllByTestId('badge')
    const mockBadge = badges.find((b) => b.textContent?.includes('Mock Data'))
    expect(mockBadge).toBeUndefined()
  })
})
