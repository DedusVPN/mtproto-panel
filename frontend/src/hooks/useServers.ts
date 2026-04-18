import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { servers } from '@/api/client'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import type { StoredServerCreate, StoredServerUpdate } from '@/types'

export function useServers() {
  const setServers = useAppStore((s) => s.setServers)

  return useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const list = await servers.list()
      setServers(list)
      return list
    },
  })
}

export function useCreateServer() {
  const qc = useQueryClient()
  const setSelectedServerId = useAppStore((s) => s.setSelectedServerId)

  return useMutation({
    mutationFn: (body: StoredServerCreate) => servers.create(body),
    onSuccess: async (srv) => {
      await qc.invalidateQueries({ queryKey: ['servers'] })
      setSelectedServerId(srv.id)
      toast.success(`Сервер «${srv.name}» сохранён`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useUpdateServer() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StoredServerUpdate }) =>
      servers.update(id, body),
    onSuccess: async (srv) => {
      await qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success(`Сервер «${srv.name}» обновлён`)
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

export function useDeleteServer() {
  const qc = useQueryClient()
  const { selectedServerId, setSelectedServerId } = useAppStore()

  return useMutation({
    mutationFn: (id: string) => servers.delete(id),
    onSuccess: (_, id) => {
      if (selectedServerId === id) setSelectedServerId(null)
      void qc.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Сервер удалён')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}
