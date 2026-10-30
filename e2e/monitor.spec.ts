import { expect, test } from '@playwright/test'

test('a happy-path order walks through all three services and is confirmed', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('status')).toHaveText('live', { timeout: 15_000 })
  await page.getByRole('button', { name: /Happy path/ }).click()

  const saga = page.getByRole('region', { name: 'Saga timeline' })
  await expect(saga.getByText('Order placed')).toBeVisible()
  await expect(saga.getByText('Stock reserved')).toBeVisible()
  await expect(saga.getByText('Payment captured')).toBeVisible()
  await expect(saga.getByText('Order confirmed')).toBeVisible()
  await expect(saga.locator('.status')).toHaveText('confirmed')
})

test('a declined card cancels the order and releases the stock', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Card declined/ }).click()

  const saga = page.getByRole('region', { name: 'Saga timeline' })
  await expect(saga.getByText('Payment declined')).toBeVisible()
  await expect(saga.getByText('Stock released')).toBeVisible()
  await expect(saga.locator('.status')).toHaveText('cancelled')
  await expect(saga.getByText('Why: Card declined by the issuer')).toBeVisible()
})

test('with the gateway down the order gets stuck, and a replay finishes it', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(/Card gateway down/).check()
  await page.getByRole('button', { name: /Happy path/ }).click()
  const replay = page.getByRole('button', { name: /replay/ })
  await expect(replay).toBeVisible({ timeout: 15_000 })

  await page.getByLabel(/Card gateway down/).uncheck()
  await replay.click()
  await expect(page.getByText(/1 message sent back to payments/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Saga timeline' }).locator('.status')).toHaveText('confirmed', { timeout: 15_000 })
})
