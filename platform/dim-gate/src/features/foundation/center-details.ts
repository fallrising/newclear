import { Code2, Server, Shield } from 'lucide-react'
import type { Center } from '../../domain/schemas'

export const centerDetails = {
  rd: { name: '研發中心', short: 'RD', icon: Code2, purpose: '從應用與環境，掌握你的交付範圍。', role: '研發人員', responsibility: '探索獲授權專案的應用與環境，申請資源、模擬發布、查看觀測證據並回滾。' },
  ops: { name: '維運中心', short: 'OPS', icon: Server, purpose: '以一致的資源視圖，理解基礎設施。', role: '維運人員', responsibility: '納管獲授權的示範資源，審批與交付環境，從事件追查依賴、發布及恢復證據。' },
  admin: { name: '平台管理', short: 'ADMIN', icon: Shield, purpose: '讓組織與權限，有清楚的管理邊界。', role: '平台管理員', responsibility: '管理角色範圍、導航、服務目錄與自訂欄位，檢查模擬整合與管理稽核。平台管理權限不包含部署權限。' },
} satisfies Record<Center, { name: string; short: string; icon: typeof Code2; purpose: string; role: string; responsibility: string }>
