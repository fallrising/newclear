import { personaSchema, type Persona } from '../../domain/schemas'

export const personas: Persona[] = [
  { id: 'user-rd-commerce', displayName: '林予安 · Commerce RD', description: 'Store 專案的應用與環境', centers: ['rd'] },
  { id: 'user-rd-data', displayName: '陳以晴 · Data RD', description: 'Data 專案的應用與環境', centers: ['rd'] },
  { id: 'user-ops', displayName: '周柏宇 · Platform Ops', description: '三個資源池與兩個專案的維運範圍', centers: ['ops'] },
  { id: 'user-admin', displayName: '吳知行 · Platform Admin', description: '企業配置與授權管理；未授予發布權', centers: ['admin'] },
].map((persona) => personaSchema.parse(persona))
