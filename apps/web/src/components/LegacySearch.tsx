import { FormEvent, useMemo, useState } from 'react'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@public-records/ui/table'
import { cn } from '@public-records/ui/utils'

interface SearchResult {
  source: string
  title?: string
  snippet?: string
  url?: string
  found: string
}

const SEARCH_SOURCES: Array<{ label: string; value: string }> = [
  { label: 'Web (Bing snippets)', value: 'bing' },
  { label: 'Public UCC filings (preview dataset)', value: 'ucc' },
  { label: 'Both', value: 'both' }
]

export function LegacySearch() {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<string>(SEARCH_SOURCES[0]?.value ?? 'bing')
  const [status, setStatus] = useState('Idle')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasResults = results.length > 0

  const statusDescription = useMemo(() => {
    if (error) {
      return error
    }

    return status
  }, [error, status])

  const handleSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!query.trim()) {
      setError('Type a search phrase first')
      return
    }

    setIsLoading(true)
    setError(null)
    setStatus('Searching…')
    setResults([])

    try {
      const url = new URL('/api/search', window.location.origin)
      url.searchParams.set('q', query.trim())
      url.searchParams.set('source', source)

      const response = await fetch(url.toString())

      if (!response.ok) {
        throw new Error('Server error')
      }

      const data = (await response.json()) as { results: SearchResult[] }
      const deduped = Array.isArray(data.results) ? data.results : []

      setResults(deduped)
      setStatus(
        `Found ${deduped.length} item${deduped.length === 1 ? '' : 's'} (duplicates filtered)`
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      setError(`Error: ${message}`)
      setStatus('Idle')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClear = () => {
    setQuery('')
    setResults([])
    setStatus('Idle')
    setError(null)
  }

  const formattedResults = useMemo(() => {
    return results.map((result) => {
      const foundDate = new Date(result.found)
      const isValidDate = !Number.isNaN(foundDate.getTime())

      return {
        ...result,
        foundFormatted: isValidDate ? foundDate.toLocaleString() : result.found
      }
    })
  }, [results])

  return (
    <section className="glass-effect rounded-lg p-4 sm:p-6 space-y-4">
      <div className="space-y-2">
        <h2 className="text-xl sm:text-2xl font-semibold text-white">Legacy Web & Filing Search</h2>
        <p className="text-sm sm:text-base text-white/70">
          Run the original keyword search experience directly inside the React dashboard.
        </p>
      </div>

      <form
        onSubmit={handleSearch}
        className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-end"
      >
        <div className="flex-1 space-y-2">
          <label className="text-xs uppercase tracking-wide text-white/60">Query</label>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Example: 'seeking MCA', 'need funding', 'UCC financing statement' …"
            className="glass-effect border-white/30 text-white placeholder:text-white/50"
          />
        </div>

        <div className="min-w-[220px] space-y-2">
          <label className="text-xs uppercase tracking-wide text-white/60">Source</label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="glass-effect border-white/30 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-effect border-white/30">
              {SEARCH_SOURCES.map(({ label, value }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button type="submit" className="h-10 sm:h-11" disabled={isLoading}>
            {isLoading ? 'Searching…' : 'Start Search'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={cn('h-10 sm:h-11', isLoading && 'opacity-60')}
            onClick={handleClear}
            disabled={isLoading && results.length === 0}
          >
            Clear
          </Button>
        </div>
      </form>

      <div className="text-sm text-white/70" role="status">
        {statusDescription}
      </div>

      {hasResults && (
        <div className="overflow-x-auto">
          <Table className="min-w-full">
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-white/70">Source</TableHead>
                <TableHead className="text-white/70">Snippet / Title</TableHead>
                <TableHead className="text-white/70">Link</TableHead>
                <TableHead className="text-white/70">Found</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formattedResults.map((result, index) => (
                <TableRow
                  key={`${result.url ?? result.title ?? index}-${index}`}
                  className="border-white/5"
                >
                  <TableCell className="text-xs text-white/60 capitalize">
                    {result.source || 'n/a'}
                  </TableCell>
                  <TableCell className="space-y-1">
                    <p className="font-semibold text-white">
                      {result.title || result.snippet || 'n/a'}
                    </p>
                    {result.snippet && <p className="text-sm text-white/70">{result.snippet}</p>}
                  </TableCell>
                  <TableCell>
                    {result.url ? (
                      <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-white/50">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-white/60 whitespace-nowrap">
                    {result.foundFormatted}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

export default LegacySearch
