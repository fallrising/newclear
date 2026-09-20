import { Code2, Server, Shield } from 'lucide-react'
import type { Center } from '../../domain/schemas'

export const centerDetails = {
  rd: { name: '研發中心', short: 'RD', icon: Code2, purpose: '從應用與環境，掌握你的交付範圍。', role: '研發人員', responsibility: '探索獲授權專案的應用、環境與關聯資源。環境申請與發布流程將在後續里程碑開放。' },
  ops: { name: '維運中心', short: 'OPS', icon: Server, purpose: '以一致的資源視圖，理解基礎設施。', role: '維運人員', responsibility: '查看獲授權資源池與專案的示範資產。資源納管、審批與故障處理將在後續里程碑開放。' },
  admin: { name: '平台管理', short: 'ADMIN', icon: Shield, purpose: '讓組織與權限，有清楚的管理邊界。', role: '平台管理員', responsibility: '查看企業層級的示範 metadata。平台管理權限不包含部署權限；角色與目錄編輯將在後續里程碑開放。' },
} satisfies Record<Center, { name: string; short: string; icon: typeof Code2; purpose: string; role: string; responsibility: string }>
