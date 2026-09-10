import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('accessibility', () => {
	test(
		'home page has no serious or critical axe violations',
		{ tag: '@a11y' },
		async ({ page }) => {
			await page.goto('/');
			const results = await new AxeBuilder({ page }).analyze();
			const violations = results.violations.filter(
				(violation) => violation.impact === 'serious' || violation.impact === 'critical'
			);
			expect(violations).toEqual([]);
		}
	);
});
