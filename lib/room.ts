export const getRoomKeys = (roomId: string) => {
  const normalized = roomId?.trim() || 'global'
  return {
    roomId: normalized,
    messagesKey: `room:${normalized}:messages`,
    hostKey: `room:${normalized}:host`,
    balancesKey: `room:${normalized}:balances`,
    lockKey: `room:${normalized}:lock`,
  }
}

export const normalizeRoomId = (value?: string | null) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'global'
}
