import { Button } from '@public-records/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SettingsMenu } from '@/components/SettingsMenu'
import { ArrowClockwise, CurrencyDollar, Info } from '@phosphor-icons/react'

type HashRoute = 'dashboard' | 'pricing' | 'billing/success' | 'billing/cancel'

interface HeaderProps {
  onRefresh: () => void
  onNavigate?: (route: HashRoute) => void
}

export function Header({ onRefresh, onNavigate }: HeaderProps) {
  const isDemoMode =
    import.meta.env.DEV ||
    ['1', 'true', 'yes'].includes(String(import.meta.env.VITE_USE_MOCK_DATA ?? '').toLowerCase())

  return (
    <header className="mica-effect border-b-2 border-primary/20 sticky top-0 z-50 shadow-xl shadow-primary/10">
      <div className="container mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-5">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => onNavigate?.('dashboard')}
                className="text-left focus:outline-none"
              >
                <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight text-white truncate bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                  UCC-MCA Intelligence Platform
                </h1>
              </button>
              {isDemoMode && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Info size={10} weight="fill" />
                  DEMO
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-white/80 hidden sm:block font-medium">
              {isDemoMode
                ? 'Demo Mode - Simulated Data'
                : 'Automated merchant cash advance opportunity discovery'}
            </p>
          </div>
          {/* Header Actions */}
          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate?.('pricing')}
              className="text-white/70 hover:text-white hover:bg-white/10"
            >
              <CurrencyDollar size={16} weight="bold" className="sm:mr-1" />
              <span className="sr-only sm:not-sr-only">Pricing</span>
            </Button>
            <ThemeToggle />
            <SettingsMenu />
            <Button
              variant="outline"
              onClick={onRefresh}
              size="sm"
              className="glass-effect border-white/30 text-white hover:bg-white/10 hover:border-white/50"
            >
              <ArrowClockwise size={16} weight="bold" className="sm:mr-2" />
              <span className="sr-only sm:not-sr-only">Refresh Data</span>
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
