import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Order, SystemState, TimelineEntry } from './types'

/**
 * Subscribes to the saga timeline over Server-Sent Events. EventSource reconnects by itself and
 * sends the last event id it saw, so nothing is shown twice (groupByOrder also dedupes by id).
 */
export function useTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const source = new EventSource('/api/timeline/stream')
    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => {
      const entry = { ...(JSON.parse(message.data) as Omit<TimelineEntry, 'id'>), id: message.lastEventId }
      setEntries((list) => [...list, entry].slice(-1500))
    }
    return () => source.close()
  }, [])
  return { entries, connected }
}

/** Polls a loader on an interval; `refresh` triggers an immediate reload. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null)
  // Keep the latest loader in a ref (updated after render) so the interval never restarts.
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })
  const refresh = useCallback(async () => {
    try {
      setData(await loader.current())
    } catch {
      // keep the last good value; the next tick will try again
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(timer)
  }, [refresh, intervalMs])
  return { data, refresh }
}

export const useOrders = () => usePolling<Order[]>(api.orders, 1500)
export const useSystem = () => usePolling<SystemState>(api.system, 2000)

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
