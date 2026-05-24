import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { useKV as sparkUseKV } from '@github/spark/hooks'

export type UseSafeKVReturn<T> = [T, Dispatch<SetStateAction<T>>, () => void]

function readFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const stored = window.localStorage.getItem(key)
    if (stored === null) {
      return fallback
    }

    return JSON.parse(stored) as T
  } catch (error) {
    console.warn(`[useSafeKV] Failed to parse stored value for key "${key}".`, error)
    return fallback
  }
}

function writeToStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    console.warn(`[useSafeKV] Failed to persist value for key "${key}".`, error)
  }
}

function deleteFromStorage(key: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(key)
  } catch (error) {
    console.warn(`[useSafeKV] Failed to remove value for key "${key}".`, error)
  }
}

export function useSafeKV<T>(key: string, initialValue: T): UseSafeKVReturn<T> {
  const initialValueRef = useRef(initialValue)
  // Tracks whether we have already logged a Spark-unavailable warning so we do
  // not spam the console on every render of the fallback path.
  const warnedRef = useRef(false)

  // --- Fallback hooks (always called, in a fixed order) -------------------
  // These hooks are invoked on EVERY render regardless of whether Spark is
  // available. This guarantees a stable hook order (Rules of Hooks) instead of
  // conditionally calling hooks / returning early as the previous version did.
  const [fallbackValue, setFallbackValue] = useState<T>(() =>
    readFromStorage(key, initialValueRef.current)
  )

  useEffect(() => {
    initialValueRef.current = initialValue
  }, [initialValue])

  const setFallback = useCallback<Dispatch<SetStateAction<T>>>(
    (valueOrUpdater) => {
      setFallbackValue((prev) => {
        const next =
          typeof valueOrUpdater === 'function'
            ? (valueOrUpdater as (prevState: T) => T)(prev)
            : valueOrUpdater

        writeToStorage(key, next)
        return next
      })
    },
    [key]
  )

  const deleteFallback = useCallback(() => {
    deleteFromStorage(key)
    setFallbackValue(initialValueRef.current)
  }, [key])

  const fallbackResult = useMemo(
    () => [fallbackValue, setFallback, deleteFallback] as UseSafeKVReturn<T>,
    [fallbackValue, setFallback, deleteFallback]
  )

  // --- Spark attempt (also called unconditionally on every render) --------
  // Attempt Spark on every render so its internal hooks are registered in the
  // same order each time. Whether Spark is available is an environment-level
  // invariant, so it either consistently succeeds (always registering its
  // hooks) or consistently throws before registering any hook.
  let sparkResult: UseSafeKVReturn<T> | null = null
  try {
    sparkResult = sparkUseKV<T>(key, initialValue) as UseSafeKVReturn<T>
  } catch (error) {
    if (!warnedRef.current) {
      warnedRef.current = true
      console.warn(`[useSafeKV] Falling back to local storage for key "${key}".`, error)
    }
  }

  return sparkResult ?? fallbackResult
}

export default useSafeKV
