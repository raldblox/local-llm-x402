'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

export type Message = {
  id: string
  roomId: string
  kind: 'prompt' | 'response' | 'system'
  from: string
  text: string
  createdAt: number
  promptId: string | null
  meta?: {
    txHash?: string
    amountMicroUsdc?: string
    tokenUsage?: number
    tokensPerSecond?: number
    modelId?: string
  }
}

export type HostState = {
  hostAddr: string
  recvAddr: string
  rateUsdcPer1k: number
  lmStudioUrl: string
  lmStudioToken?: string
  modelId: string
  modelConnected: boolean
  lastSeen: number
}

type ChatStore = {
  hostState: HostState | null
  setHostState: (host: HostState | null) => void
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  balances: Record<string, number>
  setBalance: (addr: string, amount: number) => void
  addBalance: (addr: string, delta: number) => void
}

const ChatContext = createContext<ChatStore | null>(null)

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [hostState, setHostState] = useState<HostState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const tabId = useRef<string | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const suppressRef = useRef({ host: false, messages: false, balances: false })

  const store = useMemo<ChatStore>(
    () => ({
      hostState,
      setHostState,
      messages,
      setMessages,
      balances,
      setBalance: (addr, amount) => {
        setBalances((prev) => ({ ...prev, [addr]: amount }))
      },
      addBalance: (addr, delta) => {
        setBalances((prev) => ({ ...prev, [addr]: (prev[addr] ?? 0) + delta }))
      },
    }),
    [hostState, messages, balances],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
    if (!tabId.current) {
      tabId.current = crypto.randomUUID()
    }
    const channel = new BroadcastChannel('local-llm-x402')
    channelRef.current = channel

    channel.onmessage = (event) => {
      const data = event.data as { source?: string; type?: string; payload?: unknown }
      if (!data || data.source === tabId.current) return
      if (data.type === 'host') {
        suppressRef.current.host = true
        setHostState((data.payload as HostState | null) ?? null)
      }
      if (data.type === 'messages') {
        suppressRef.current.messages = true
        setMessages(Array.isArray(data.payload) ? (data.payload as Message[]) : [])
      }
      if (data.type === 'balances') {
        suppressRef.current.balances = true
        setBalances(
          data.payload && typeof data.payload === 'object'
            ? (data.payload as Record<string, number>)
            : {},
        )
      }
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!channelRef.current || !tabId.current) return
    if (suppressRef.current.host) {
      suppressRef.current.host = false
      return
    }
    channelRef.current.postMessage({ source: tabId.current, type: 'host', payload: hostState })
  }, [hostState])

  useEffect(() => {
    if (!channelRef.current || !tabId.current) return
    if (suppressRef.current.messages) {
      suppressRef.current.messages = false
      return
    }
    channelRef.current.postMessage({ source: tabId.current, type: 'messages', payload: messages })
  }, [messages])

  useEffect(() => {
    if (!channelRef.current || !tabId.current) return
    if (suppressRef.current.balances) {
      suppressRef.current.balances = false
      return
    }
    channelRef.current.postMessage({ source: tabId.current, type: 'balances', payload: balances })
  }, [balances])

  return <ChatContext.Provider value={store}>{children}</ChatContext.Provider>
}

export const useChatStore = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChatStore must be used within ChatProvider')
  }
  return context
}
