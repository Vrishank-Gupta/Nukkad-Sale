import type { Seller } from '../env'

/** Optional selling tools. All on unless the seller switches one off in Settings. */
export const TOOLS = ['discount', 'offers', 'waitlist', 'profit', 'labels'] as const
export type Tool = (typeof TOOLS)[number]

export const toolOn = (s: Pick<Seller, 'tools_off'> | null | undefined, tool: Tool) =>
  !(s?.tools_off ?? '').split(',').includes(tool)
