import { useSyncExternalStore } from 'react'
import { getPlotDetail, setPlotDetail, subscribePlotDetail } from '../lib/preferences'

/** The graph detail setting, shared by Settings and every graph on screen. */
export function usePlotDetail(): [number, (value: number) => void] {
  const detail = useSyncExternalStore(subscribePlotDetail, getPlotDetail, getPlotDetail)
  return [detail, setPlotDetail]
}
