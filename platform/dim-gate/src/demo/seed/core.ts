import { personaSchema, type Persona } from '../../domain/schemas'

export const personas: Persona[] = [
  { id: 'user-rd-commerce', displayName: '林予安 · Commerce RD', description: 'Store 專案的應用與環境', centers: ['rd'] },
  { id: 'user-rd-data', displayName: '陳以晴 · Data RD', description: 'Data 專案的應用與環境', centers: ['rd'] },
  { id: 'user-ops', displayName: '周柏宇 · Platform Ops', description: '三個資源池與四個專案的維運範圍', centers: ['ops'] },
  { id: 'user-admin', displayName: '吳知行 · Platform Admin', description: '企業配置與授權管理；未授予發布權', centers: ['admin'] },
  { id: 'w2-user-ops-secondary', displayName: '許若庭 · Second Ops', description: '獨立審批共享資源；三個資源池與四個專案', centers: ['ops'] },
  { id: 'w2-user-multi', displayName: '江知遠 · RD / Ops', description: '同一使用者的 Store RD 與三個資源池 Ops 授權', centers: ['rd', 'ops'] },
  { id: 'w2-user-no-grant', displayName: '沈語禾 · No grant', description: '尚未獲授權的示範使用者；可返回示範控制台', centers: [] },
].map((persona) => personaSchema.parse(persona))
