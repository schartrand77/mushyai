import { expect, test } from "@playwright/test";
test.describe("mushyai docker app", () => {
  test("loads the control room shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Mushy AI Control Room");
    await expect(
      page.getByRole("heading", { name: "Mushy AI Control Room" }),
    ).toBeVisible();
    await expect(page.getByText("Private mode enabled.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "High-resolution preview" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "3D generation trace" }),
    ).toBeVisible();
  });

  test("queues a job, advances the pipeline, and persists after reload", async ({
    page,
  }) => {
    await page.goto("/");

    await page
      .locator("#prompt")
      .fill(
        "A hand-thrown ceramic lantern with cutout stars, warm glaze, and studio rim light",
      );
    await page.locator("#stylePreset").selectOption("stylized");
    await page.locator("#topology").selectOption("cinematic");
    await page.locator("#textureDetail").selectOption("4k");
    await page.getByRole("button", { name: "Queue generation" }).click();

    await expect(page.locator("#active-job-badge")).toHaveText("Queued");
    await expect(page.locator("#job-list")).toContainText(
      "A hand-thrown ceramic lantern",
    );
    await expect(page.locator("#preview-subject")).toContainText(
      "A hand-thrown ceramic lantern",
    );
    await expect(page.locator("#preview-shape")).toHaveText("Shape: cylinder");
    await expect(page.locator("#debug-script")).toContainText(
      "primitive_cylinder_add",
    );
    await expect(page.locator("#download-model")).toBeEnabled();

    await expect
      .poll(async () => page.locator("#active-progress").textContent())
      .toBe("20%");
    await expect(page.locator("#pipeline-stages")).toContainText(
      "Input cleanup",
    );

    await page.reload();

    await expect(page.locator("#job-list")).toContainText(
      "A hand-thrown ceramic lantern",
    );
    await expect(page.locator("#active-job-badge")).not.toHaveText(
      "No active job",
    );
  });

  test("pins a delivered preview until it is cleared", async ({ page }) => {
    await page.goto("/");

    await page
      .locator("#prompt")
      .fill("A brushed brass lantern with cutout stars and warm rim light");
    await page.getByRole("button", { name: "Queue generation" }).click();

    await expect(page.locator("#preview-subject")).toContainText(
      "Product model",
    );
    await expect(page.locator("#download-model")).toBeEnabled();
    await expect
      .poll(async () => page.locator("#preview-mode").textContent())
      .toBe("Delivered");

    await page.getByRole("button", { name: "Clear completed" }).click();
    await expect(page.locator("#job-list")).not.toContainText("Product model");
    await expect(page.locator("#preview-mode")).toHaveText("Delivered");

    await page.getByRole("button", { name: "Clear preview" }).click();
    await expect(page.locator("#preview-mode")).toHaveText("Idle");
  });
});
