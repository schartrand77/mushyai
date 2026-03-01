import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test.describe("mushyai docker app", () => {
  test("loads the control room shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Mushy AI Control Room");
    await expect(page.getByRole("heading", { name: "Mushy AI Control Room" })).toBeVisible();
    await expect(page.getByText("Private mode enabled.")).toBeVisible();
  });

  test("queues a job, advances the pipeline, and persists after reload", async ({ page }) => {
    await page.goto("/");

    await page.locator("#prompt").fill(
      "A hand-thrown ceramic lantern with cutout stars, warm glaze, and studio rim light",
    );
    await page.locator("#stylePreset").selectOption("stylized");
    await page.locator("#topology").selectOption("cinematic");
    await page.locator("#textureDetail").selectOption("4k");
    await page.getByRole("button", { name: "Queue generation" }).click();

    await expect(page.locator("#active-job-badge")).toHaveText("Queued");
    await expect(page.locator("#job-list")).toContainText("A hand-thrown ceramic lantern");

    await expect.poll(async () => page.locator("#active-progress").textContent()).toBe("20%");
    await expect(page.locator("#pipeline-stages")).toContainText("Input cleanup");

    await page.reload();

    await expect(page.locator("#job-list")).toContainText("A hand-thrown ceramic lantern");
    await expect(page.locator("#active-job-badge")).not.toHaveText("No active job");
  });

  test("uses a square image to create a perfect cube calibration job", async ({ page }) => {
    await page.goto("/");

    await page.locator("#calibrationImage").setInputFiles(path.join(fixtureDirectory, "square.svg"));
    await page.getByRole("button", { name: "Calibrate cube" }).click();

    await expect(page.locator("#calibration-feedback")).toContainText("square.svg");
    await expect(page.locator("#job-list")).toContainText("Perfect cube calibration - square.svg");
    await expect(page.locator("#active-prompt")).toContainText("Perfect cube calibration");
  });
});
