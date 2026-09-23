import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { captureBrowserHealth, verifyBrowserHealth } from './browser-health'

// Only keyboard events operate the product. Locators/evaluate read evidence;
// they never click, focus, selectOption, fill, or change application state.
function keyboardUser(page: Page, actions: object[]) {
  async function reach(target: Locator) {
    await expect(target).toBeVisible()
    await expect(target).toBeEnabled()
    for (let tabs = 0; tabs < 250; tabs++) {
      if (await target.evaluate(el => el === document.activeElement)) {
        actions.push({ action: 'tab-to', target: await target.getAttribute('aria-label') ?? await target.textContent(), tabs, url: page.url() })
        return
      }
      await page.keyboard.press('Tab')
    }
    throw new Error(`Target unreachable through Tab: ${await target.evaluate(el => el.outerHTML)}`)
  }
  async function activate(target: Locator) { await reach(target); await page.keyboard.press('Enter') }
  async function type(target: Locator, value: string) {
    await reach(target)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(value)
    await expect(target).toHaveValue(value)
  }
  async function select(target: Locator, value: string) {
    await reach(target)
    const options = await target.locator('option').evaluateAll(elements => elements.map(el => (el as HTMLOptionElement).value))
    const index = options.indexOf(value)
    expect(index).toBeGreaterThanOrEqual(0)
    await page.keyboard.press('Alt+ArrowDown')
    await page.keyboard.press('Home')
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(target).toHaveValue(value)
    actions.push({ action: 'native-select-keys', value, url: page.url() })
  }
  return { reach, activate, type, select }
}

export async function completeGuide(page: Page, info: TestInfo, keyboardOnly: boolean) {
  page.setDefaultTimeout(15_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const health = captureBrowserHealth(page)
  const actions: object[] = [], accessibility: object[] = []
  const user = keyboardOnly ? keyboardUser(page, actions) : {
    reach: async (target: Locator) => { await expect(target).toBeVisible(); await target.focus() },
    activate: async (target: Locator) => { await target.click() },
    type: async (target: Locator, value: string) => { await target.fill(value) },
    select: async (target: Locator, value: string) => { await target.selectOption(value) },
  }
  const button = (name: string) => page.getByRole('button', { name, exact: true })
  const link = (name: string) => page.getByRole('link', { name, exact: true })
  const heading = page.getByRole('heading', { level: 1 })
  const guide = async () => { await user.activate(link('示範控制台')); await expect(page.getByTestId('guide-step-request')).toBeVisible() }
  const become = async (value: string) => {
    const returnToGuide = new URL(page.url()).pathname.endsWith('/guide')
    const selector = page.getByRole('combobox', { name: '示範身分' })
    await user.select(selector, value)
    await expect(selector).toHaveValue(value)
    await expect(selector).toBeEnabled()
    const destination = value === 'user-ops' ? 'ops' : value === 'user-admin' ? 'admin' : 'rd'
    await expect(page).toHaveURL(new RegExp(`/dim-gate/${destination}(?:[?#].*)?$`))
    await expect(page.getByRole('navigation', { name: '中心導覽' })).toBeVisible()
    if (returnToGuide) await guide()
  }
  const capture = async (name: string) => {
    for (const theme of ['light', 'dark'] as const) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await user.activate(button(theme === 'dark' ? '切換深色主題' : '切換淺色主題'))
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const result = await new AxeBuilder({ page }).analyze()
      const violations = result.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))
      accessibility.push({ name, theme, url: page.url(), violations })
      expect(violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await info.attach(`${name}-${theme}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
    }
    await info.attach(`${name}-dom`, { body: await page.locator('main').innerText(), contentType: 'text/plain' })
  }
  const dialogProof = async (trigger: Locator, name: string) => {
    await user.activate(trigger)
    const dialog = page.getByRole('dialog', { name, exact: true })
    await expect(dialog).toBeVisible()
    // Inspect automatic initial focus before sending any Tab event.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    actions.push({ action: 'initial-dialog-focus', name, active: await page.locator(':focus').evaluate(el => el.outerHTML) })
    for (const key of ['Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    actions.push({ action: 'dialog-escape-return', name })
    await user.activate(trigger)
    await expect(dialog).toBeVisible()
    return dialog
  }
  const clock = async (ticks: string) => {
    await user.select(page.getByRole('combobox', { name: '前進幅度', exact: true }), ticks)
    await user.activate(button('前進演示時鐘'))
    await expect(page.locator('.command-notice')).toContainText(`演示時鐘已前進 ${ticks} 個 tick`)
    await expect(button('前進演示時鐘')).toBeEnabled()
  }
  const deliveryClock = async (ticks: string) => {
    await user.select(page.getByRole('combobox', { name: '模擬前進幅度' }), ticks)
    await user.activate(button('前進模擬時鐘'))
    await expect(page.locator('.delivery-demo .command-notice')).toContainText(`模擬時鐘已前進 ${ticks} 個 tick`)
    await expect(button('前進模擬時鐘')).toBeEnabled()
  }
  try {
    await page.goto('guide')
    await expect(heading).toHaveText('示範導覽')
    await page.keyboard.press('Tab')
    await expect(link('跳到主要內容')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
    await become('user-admin')
    await user.activate(link('檢查角色範圍'))
    await expect(page.getByRole('table', { name: '固定角色與資源範圍' })).toContainText('project-store')
    await guide()
    await user.activate(link('檢查服務目錄'))
    await expect(heading).toHaveText('服務目錄治理')
    await guide()
    await user.activate(link('設定導航名稱'))
    const navRow = page.getByRole('row', { name: /admin\.catalog/ })
    await user.type(navRow.getByLabel('admin.catalog label'), '故事服務目錄')
    await user.activate(navRow.getByRole('button', { name: '儲存', exact: true }))
    await expect(link('故事服務目錄')).toBeVisible()
    await become('user-ops')
    await guide()
    await user.activate(link('檢查三種資源來源'))
    for (const provider of ['aws', 'aliyun', 'onprem']) {
      await user.select(page.getByRole('combobox', { name: /Provider/ }), provider)
      await expect(page.locator('caption')).toContainText('共 20 筆')
    }
    await guide()
    await user.activate(link('檢查共享依賴'))
    await user.type(page.getByLabel('Canonical ID'), 'ci-idc-redis-01')
    await user.reach(page.getByRole('radio', { name: '依賴', exact: true }))
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('radio', { name: '反向影響', exact: true })).toBeChecked()
    await user.activate(button('探索拓撲'))
    const topology = page.getByRole('table', { name: '目前拓撲中的可見配置關係' })
    await expect(topology).toBeVisible()
    await capture('topology-alternative')
    await user.activate(topology.getByRole('link').first())
    await expect(heading).not.toContainText('拓撲')
    await become('user-rd-commerce')
    await guide()
    await user.activate(page.getByTestId('guide-step-request').getByRole('link'))
    await user.activate(link('開始申請'))
    await user.select(page.getByRole('combobox', { name: '應用', exact: true }), 'app-checkout')
    await user.activate(button('確認並提交申請'))
    await expect(page.getByRole('textbox', { name: '環境名稱', exact: true })).toBeFocused()
    expect(await page.getByRole('textbox', { name: '環境名稱', exact: true }).evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true)
    actions.push({ action: 'invalid-required-field-focused', field: '環境名稱' })
    await user.type(page.getByRole('textbox', { name: '環境名稱', exact: true }), 'keyboard-staging')
    await user.select(page.getByRole('combobox', { name: '階段', exact: true }), 'staging')
    await user.select(page.getByRole('combobox', { name: 'Provider', exact: true }), 'aws')
    await user.type(page.getByRole('textbox', { name: '用途', exact: true }), 'Keyboard acceptance story')
    await capture('request-form')
    await user.activate(button('確認並提交申請'))
    await expect(heading).toHaveText('keyboard-staging · 待審核')
    await become('user-ops')
    await guide()
    await user.activate(page.getByTestId('guide-step-provision').getByRole('link'))
    await user.activate(button('核准並保留容量'))
    await expect(heading).toHaveText('keyboard-staging · 已核准')
    const environmentId = (await page.locator('dt').filter({ hasText: /^Environment ID$/ }).locator('..').locator('code').textContent())!
    await user.activate(button('啟動交付'))
    await expect(heading).toHaveText('keyboard-staging · 交付中')
    await guide()
    await clock('5')
    await become('user-rd-commerce')
    const releases: string[] = []
    for (const revision of ['demo-stable-001', 'demo-latency-002']) {
      await user.activate(link('Pipeline 發布'))
      const dialog = await dialogProof(button('觸發 Pipeline'), '觸發 Pipeline')
      await user.select(dialog.getByLabel('發布應用'), 'app-checkout')
      await user.select(dialog.getByLabel('發布環境'), environmentId)
      await expect(dialog.getByRole('button', { name: '確認觸發' })).toBeDisabled()
      await user.type(dialog.getByLabel('來源版本'), revision)
      await user.activate(dialog.getByRole('button', { name: '確認觸發' }))
      await expect(page).toHaveURL(/\/rd\/pipelines\/[^/?]+$/)
      await deliveryClock('6')
      await expect(heading).toContainText('成功')
      await user.activate(page.locator('dt').filter({ hasText: /^候選發布$/ }).locator('..').getByRole('link'))
      await expect(page).toHaveURL(/\/releases\/[^/?]+$/)
      releases.push(new URL(page.url()).pathname.split('/').at(-1)!)
    }
    await capture('successful-release')
    await guide()
    await user.select(page.getByRole('combobox', { name: '情境環境' }), environmentId)
    await user.activate(button('注入發布後延遲'))
    await expect(page.getByText('已注入三個一分鐘異常樣本；可前往觀測與事件詳情。')).toBeVisible()
    await user.activate(page.getByTestId('guide-step-observe').getByRole('link'))
    await expect(page.getByRole('region', { name: 'RED metrics' })).toContainText('3 筆樣本')
    await user.activate(page.getByText('錯誤率資料表', { exact: true }))
    await expect(page.getByRole('table', { name: '錯誤率 · 原始樣本值' })).toContainText(/8\s*%/)
    await user.activate(page.getByRole('table', { name: '目前環境與時間範圍的 Trace' }).getByRole('link', { name: 'GET /checkout · demo', exact: true }).first())
    await expect(page.getByRole('heading', { name: 'Trace waterfall · GET /checkout · demo' })).toBeVisible()
    await user.activate(link('查看此 Trace 的日誌'))
    await expect(page.getByRole('table', { name: 'Trace／Release 關聯日誌' })).toContainText(releases[1])
    await capture('correlated-observation')
    await become('user-ops')
    await guide()
    await user.activate(page.getByTestId('guide-step-investigate').getByRole('link'))
    const incidentId = new URL(page.url()).pathname.split('/').at(-1)!
    for (const title of ['認領事件', '開始調查']) {
      const dialog = await dialogProof(button(title), title)
      await user.type(dialog.getByLabel('操作理由'), 'Keyboard observation diagnosis')
      await user.activate(dialog.getByRole('button', { name: `確認${title}`, exact: true }))
      await expect(dialog).toBeHidden()
    }
    await capture('incident-investigation')
    await become('user-rd-commerce')
    await guide()
    await user.activate(page.getByTestId('guide-step-rollback').getByRole('link'))
    const rollbackDialog = await dialogProof(button('回滾版本'), '回滾版本')
    await user.select(rollbackDialog.getByLabel('回滾目標'), releases[0])
    await user.type(rollbackDialog.getByLabel('回滾理由'), 'Keyboard recovery to stable artifact')
    await user.activate(rollbackDialog.getByRole('button', { name: '確認回滾' }))
    await expect(rollbackDialog).toBeHidden()
    await deliveryClock('3')
    await expect(heading).toContainText('成功')
    await guide()
    for (let sample = 1; sample <= 3; sample++) await clock('60')
    const steps = page.locator('[data-testid^="guide-step-"]')
    await expect(steps).toHaveCount(8)
    for (const step of await steps.all()) await expect(step).toHaveAttribute('data-completed', 'true')
    await capture('complete-guide')
    await become('user-admin')
    await user.activate(link('查看完整管理稽核'))
    await expect(page.getByRole('table')).toContainText(incidentId)
    await capture('causal-audit')
    await guide()
    const reset = await dialogProof(button('重置示範'), '重置這個示範 session？')
    await user.activate(reset.getByRole('button', { name: '確認重置示範' }))
    await expect(page.getByTestId('logical-clock')).toHaveText(/^0\s*ticks$/)
    await expect(steps).toHaveCount(8)
    for (const step of await steps.all()) await expect(step).toHaveAttribute('data-completed', 'false')
  } finally {
    actions.push({ interactionMode: keyboardOnly ? 'keyboard-only' : 'visible-UI-smoke' })
    await attachEvidence(info, actions, accessibility)
    await verifyBrowserHealth(page, info, health)
  }
}

async function attachEvidence(info: TestInfo, actions: object[], accessibility: object[]) {
  await info.attach('keyboard-actions', { body: JSON.stringify(actions, null, 2), contentType: 'application/json' })
  await info.attach('accessibility', { body: JSON.stringify(accessibility, null, 2), contentType: 'application/json' })
}
