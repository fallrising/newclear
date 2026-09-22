import { test } from '@playwright/test'
import { completeGuide } from './m5-guide'

test('AC-26/30: keyboard-only complete Guide, forms, topology, diagnosis, rollback and reset', async ({ page }, info) => {
  test.setTimeout(240_000)
  await completeGuide(page, info, true)
})
