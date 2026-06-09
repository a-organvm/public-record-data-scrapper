import { ComponentProps } from 'react'
import GripVerticalIcon from 'lucide-react/dist/esm/icons/grip-vertical'
import { Group, Panel, Separator } from 'react-resizable-panels'
const ResizablePrimitive = { PanelGroup: Group, Panel, PanelResizeHandle: Separator }

import { cn } from './utils'

function ResizablePanelGroup({
  className,
  ...props
}: ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      // v4 applies display:flex + flexDirection inline from the `orientation`
      // prop, so no direction class is needed here (the old
      // data-panel-group-direction attribute no longer exists in v4).
      className={cn('h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      // v4 emits aria-orientation on the separator (ARIA-inverted: a vertical
      // group renders a horizontal splitter bar), replacing the removed
      // data-panel-group-direction attribute the old variants keyed on.
      className={cn(
        'bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0 [&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
