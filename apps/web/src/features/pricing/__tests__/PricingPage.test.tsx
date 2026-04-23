import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as PricingPageModule from '../PricingPage'
import * as NavigationModule from '../navigation'

describe('PricingPage', () => {
  const fetchMock = vi.fn()
  const redirectMock = vi.fn()

  beforeEach(() => {
    vi.restoreAllMocks()
    fetchMock.mockReset()
    redirectMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(NavigationModule, 'navigateToExternal').mockImplementation(redirectMock)
  })

  it('renders free, starter, and pro plans', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        configured: true,
        provider: 'stripe',
        tiers: {
          starter: true,
          pro: true
        }
      })
    })

    render(<PricingPageModule.PricingPage onNavigateBack={() => {}} />)

    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Starter')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/billing/status')
    })
  })

  it('starts Stripe checkout from a paid signup when billing is configured', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          configured: true,
          provider: 'stripe',
          tiers: {
            starter: true,
            pro: true
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'checkout',
          url: 'https://checkout.stripe.test/session'
        })
      })

    render(<PricingPageModule.PricingPage onNavigateBack={() => {}} />)

    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'operator@example.com' }
    })
    fireEvent.change(screen.getByLabelText(/Company Name/i), {
      target: { value: 'Acme Funding' }
    })
    const goProButton = await screen.findByRole('button', { name: 'Go Pro' })
    fireEvent.click(goProButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/billing/signup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            plan: 'pro',
            email: 'operator@example.com',
            companyName: 'Acme Funding'
          })
        })
      )
      expect(redirectMock).toHaveBeenCalledWith('https://checkout.stripe.test/session')
    })
  })

  it('shows a waitlist state when paid billing is unavailable', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        configured: false,
        provider: 'none',
        tiers: {}
      })
    })

    render(<PricingPageModule.PricingPage onNavigateBack={() => {}} />)

    await waitFor(() => {
      expect(screen.getAllByText('Join Waitlist')).toHaveLength(2)
    })
  })

  it('shows a free signup confirmation when the backend captures the request', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          configured: false,
          provider: 'none',
          tiers: {}
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'free'
        })
      })

    render(<PricingPageModule.PricingPage onNavigateBack={() => {}} />)

    fireEvent.change(screen.getByLabelText(/Work Email/i), {
      target: { value: 'operator@example.com' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start Free' }))

    await waitFor(() => {
      expect(screen.getByText('Free Access Captured')).toBeInTheDocument()
    })
  })
})
