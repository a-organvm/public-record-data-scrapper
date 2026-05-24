import { Button } from '@public-records/ui/button'
import { Badge } from '@public-records/ui/badge'
import { Checkbox } from '@public-records/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@public-records/ui/dropdown-menu'
import { CaretDown, Export, Trash, UserPlus } from '@phosphor-icons/react'
import { Prospect } from '@public-records/core'
import { useIsMobile } from '@public-records/ui/use-mobile'

interface BatchOperationsProps {
  prospects: Prospect[]
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onBatchClaim: (ids: string[]) => void
  onBatchExport: (ids: string[]) => void
  onBatchDelete: (ids: string[]) => void
}

export function BatchOperations({
  prospects,
  selectedIds,
  onSelectionChange,
  onBatchClaim,
  onBatchExport,
  onBatchDelete
}: BatchOperationsProps) {
  const isMobile = useIsMobile()
  const allIds = prospects.map((p) => p.id)
  const visibleIdSet = new Set(allIds)
  // Only consider selections that map to a currently-visible prospect. The
  // selection store can outlive the list it was built against (filters/refresh),
  // so we intersect at the component boundary to avoid acting on stale ids.
  const selectedCount = allIds.filter((id) => selectedIds.has(id)).length
  const isAllSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))
  const isSomeSelected = selectedCount > 0 && !isAllSelected

  const handleToggleAll = () => {
    if (isAllSelected) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(allIds))
    }
  }

  const handleBatchAction = (action: 'claim' | 'export' | 'delete') => {
    // Never let a destructive/batch action touch ids that aren't visible.
    const ids = Array.from(selectedIds).filter((id) => visibleIdSet.has(id))
    switch (action) {
      case 'claim':
        onBatchClaim(ids)
        break
      case 'export':
        onBatchExport(ids)
        break
      case 'delete':
        onBatchDelete(ids)
        break
    }
    onSelectionChange(new Set())
  }

  if (prospects.length === 0) return null

  return (
    <>
      {/* Desktop: Inline controls */}
      <div className="hidden md:flex flex-row items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={isAllSelected || (isSomeSelected ? 'indeterminate' : false)}
            onCheckedChange={handleToggleAll}
            className="glass-effect border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <span className="text-sm text-white/70">
            {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
          </span>
        </div>

        {selectedCount > 0 && (
          <>
            <Badge variant="secondary" className="glass-effect border-white/30">
              {selectedCount} prospects
            </Badge>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="glass-effect border-white/30 text-white h-9 text-sm"
                >
                  Batch Actions
                  <CaretDown size={14} className="ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="glass-effect border-white/30">
                <DropdownMenuItem onClick={() => handleBatchAction('claim')}>
                  <UserPlus size={16} className="mr-2" />
                  Claim Selected ({selectedCount})
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchAction('export')}>
                  <Export size={16} className="mr-2" />
                  Export Selected ({selectedCount})
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleBatchAction('delete')}
                  className="text-destructive"
                >
                  <Trash size={16} className="mr-2" />
                  Remove Selected ({selectedCount})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {/* Mobile: Select all checkbox inline */}
      <div className="md:hidden flex items-center gap-2 mb-3">
        <Checkbox
          checked={isAllSelected || (isSomeSelected ? 'indeterminate' : false)}
          onCheckedChange={handleToggleAll}
          className="glass-effect border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
        />
        <span className="text-xs text-white/70">
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
        </span>
      </div>

      {/* Mobile: Sticky selection bar (above bottom nav) */}
      {isMobile && selectedCount > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-40 p-3 glass-effect border-t border-white/20 safe-area-pb">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBatchAction('claim')}
                className="h-10 touch-target glass-effect border-white/30"
              >
                <UserPlus size={18} weight="bold" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBatchAction('export')}
                className="h-10 touch-target glass-effect border-white/30"
              >
                <Export size={18} weight="bold" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBatchAction('delete')}
                className="h-10 touch-target glass-effect border-white/30 text-destructive hover:text-destructive"
              >
                <Trash size={18} weight="bold" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
