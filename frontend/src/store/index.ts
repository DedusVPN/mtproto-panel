import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { StoredServer } from '@/types'

type View = 'servers' | 'stats' | 'providers' | 'cloudflare'

interface AppState {
  view: View
  setView: (v: View) => void

  selectedServerId: string | null
  setSelectedServerId: (id: string | null) => void

  servers: StoredServer[]
  setServers: (s: StoredServer[]) => void

  statsHistoryRange: string
  setStatsHistoryRange: (v: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: 'servers',
      setView: (view) => set({ view }),

      selectedServerId: null,
      setSelectedServerId: (id) => set({ selectedServerId: id }),

      servers: [],
      setServers: (servers) => set({ servers }),

      statsHistoryRange: 'all',
      setStatsHistoryRange: (v) => set({ statsHistoryRange: v }),
    }),
    {
      name: 'telemt-panel',
      partialize: (s) => ({
        view: s.view,
        selectedServerId: s.selectedServerId,
        statsHistoryRange: s.statsHistoryRange,
      }),
    }
  )
)
