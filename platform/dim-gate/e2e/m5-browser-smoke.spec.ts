import { test } from '@playwright/test'
import { completeGuide } from './m5-guide'

test('AC-30: additional browser complete visible Guide story', async ({ page }, info) => {
  test.setTimeout(240_000)
  await completeGuide(page, info, false)
})
