import { useCallback, useRef } from 'react'

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback((
    path: string,
    onMessage: (msg: unknown) => void,
    onClose?: () => void
  ) => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}${path}`)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data as string))
      } catch {
        onMessage({ type: 'log', message: ev.data })
      }
    }

    ws.onerror = () => onMessage({ type: 'error', message: 'WebSocket: ошибка соединения' })

    ws.onclose = () => {
      wsRef.current = null
      onClose?.()
    }

    return ws
  }, [])

  const disconnect = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  const send = useCallback((data: unknown) => {
    wsRef.current?.send(JSON.stringify(data))
  }, [])

  return { connect, disconnect, send, wsRef }
}
