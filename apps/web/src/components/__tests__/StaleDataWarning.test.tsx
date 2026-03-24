import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { StaleDataWarning } from '../StaleDataWarning'

vi.mock('@public-records/ui/alert', () => ({
  Alert: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <div data-testid="alert" data-variant={variant}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: ReactNode }) => (
    <div data-testid="alert-description">{children}</div>
  )
}))

vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
  }) => (
    <button data-testid="refresh-button" onClick={onClick} data-variant={variant}>
      {children}
    </button>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  ClockCounterClockwise: () => <span data-testid="clock-icon">Clock</span>,
  ArrowClockwise: () => <span data-testid="refresh-icon">Refresh</span>
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div data-testid="motion-div">{children}</div>
  }
}))

describe('StaleDataWarning', () => {
  const mockOnRefresh = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getDateDaysAgo = (days: number): string => {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date.toISOString()
  }

  describe('visibility', () => {
    it('does not render when data is less than 7 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(5)} onRefresh={mockOnRefresh} />)

      expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    })

    it('does not render when data is exactly 6 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(6)} onRefresh={mockOnRefresh} />)

      expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    })

    it('renders when data is 7 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(7)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('alert')).toBeInTheDocument()
    })

    it('renders when data is more than 7 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(14)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('alert')).toBeInTheDocument()
    })

    it('renders when data is 30+ days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(45)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('alert')).toBeInTheDocument()
    })
  })

  describe('severity', () => {
    it('uses default variant for data 7-29 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(15)} onRefresh={mockOnRefresh} />)

      const alert = screen.getByTestId('alert')
      expect(alert).toHaveAttribute('data-variant', 'default')
    })

    it('uses destructive variant for data 30+ days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(31)} onRefresh={mockOnRefresh} />)

      const alert = screen.getByTestId('alert')
      expect(alert).toHaveAttribute('data-variant', 'destructive')
    })

    it('uses destructive variant for data 60 days old', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(60)} onRefresh={mockOnRefresh} />)

      const alert = screen.getByTestId('alert')
      expect(alert).toHaveAttribute('data-variant', 'destructive')
    })
  })

  describe('content', () => {
    it('displays days since update', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      expect(screen.getByText(/Data is 10 days old/)).toBeInTheDocument()
    })

    it('shows refresh suggestion for non-critical data', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(15)} onRefresh={mockOnRefresh} />)

      expect(screen.getByText(/Consider refreshing for latest signals/)).toBeInTheDocument()
    })

    it('shows critical warning for 30+ day old data', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(35)} onRefresh={mockOnRefresh} />)

      expect(screen.getByText(/Critical: Health scores may be inaccurate/)).toBeInTheDocument()
    })

    it('displays refresh button', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      expect(screen.getByText('Refresh Now')).toBeInTheDocument()
    })

    it('displays clock icon', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('clock-icon')).toBeInTheDocument()
    })

    it('displays refresh icon in button', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('refresh-icon')).toBeInTheDocument()
    })
  })

  describe('button styling', () => {
    it('uses outline variant for non-critical', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(15)} onRefresh={mockOnRefresh} />)

      const button = screen.getByTestId('refresh-button')
      expect(button).toHaveAttribute('data-variant', 'outline')
    })

    it('uses destructive variant for critical', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(35)} onRefresh={mockOnRefresh} />)

      const button = screen.getByTestId('refresh-button')
      expect(button).toHaveAttribute('data-variant', 'destructive')
    })
  })

  describe('interactions', () => {
    it('calls onRefresh when button is clicked', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      fireEvent.click(screen.getByTestId('refresh-button'))

      expect(mockOnRefresh).toHaveBeenCalledTimes(1)
    })

    it('calls onRefresh each time button is clicked', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      const button = screen.getByTestId('refresh-button')
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(mockOnRefresh).toHaveBeenCalledTimes(3)
    })
  })

  describe('animation', () => {
    it('wraps content in motion div', () => {
      render(<StaleDataWarning lastUpdated={getDateDaysAgo(10)} onRefresh={mockOnRefresh} />)

      expect(screen.getByTestId('motion-div')).toBeInTheDocument()
    })
  })
})
