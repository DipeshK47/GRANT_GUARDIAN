import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { chromium } from "playwright";
import { env } from "../apps/orchestrator/src/config/env.js";
import { FileStorageService } from "../apps/orchestrator/src/services/storage/file-storage.js";

const parseArgs = () => {
  const args = process.argv.slice(2);
  let organizationId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--organization-id=")) {
      organizationId = arg.replace("--organization-id=", "");
      continue;
    }
    if (arg === "--organization-id") {
      organizationId = args[index + 1];
      index += 1;
    }
  }

  return {
    organizationId,
  };
};

const args = parseArgs();
const storageStatePath = new FileStorageService(env).resolveBrowserStorageStatePath(
  args.organizationId,
);

const submittableBaseUrl = env.SUBMITTABLE_BASE_URL;

const signInLandingUrl = new URL("/sign-in", submittableBaseUrl).toString();

const rl = readline.createInterface({
  input: stdin,
  output: stdout,
});

const waitForUser = async (message: string) => {
  await rl.question(message);
};

const main = async () => {
  await mkdir(path.dirname(storageStatePath), { recursive: true });

  console.log("");
  console.log("Grant Guardian: Submittable session capture");
  console.log("---------------------------------------------");
  console.log(`Sign-in landing URL: ${signInLandingUrl}`);
  console.log(`Session file: ${storageStatePath}`);
  if (args.organizationId) {
    console.log(`Organization scope: ${args.organizationId}`);
  }
  console.log("");
  console.log("What will happen:");
  console.log("1. A Chromium browser window will open.");
  console.log("2. The script will open Submittable's sign-in landing page.");
  console.log("3. It will try to open the Submittable applicant login for you.");
  console.log("4. You will complete login manually.");
  console.log("5. Come back to this terminal and press Enter.");
  console.log("6. The authenticated session will be saved for reuse.");
  console.log("");
  console.log(
    "Important: only press Enter after you are fully logged in and can see your applicant account.",
  );
  console.log("");

  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(signInLandingUrl, {
      waitUntil: "domcontentloaded",
    });

    // Submittable now uses a sign-in chooser page and then redirects to a dynamic auth URL.
    if (page.url().includes("/sign-in")) {
      const submittableProductLink = page
        .locator("a")
        .filter({ hasText: /^Submittable$/ })
        .first();

      if ((await submittableProductLink.count()) > 0) {
        await submittableProductLink.click();
        await page.waitForLoadState("domcontentloaded");
      }
    }

    console.log("The browser is open on the Submittable sign-in flow.");
    console.log(
      "If the dynamic login page did not open automatically, click the 'Submittable' sign-in option manually in the browser.",
    );
    console.log("");

    await waitForUser("Press Enter here after login is complete...");

    const currentUrl = page.url();
    if (
      currentUrl.includes("/sign-in") ||
      currentUrl.includes("/u/login") ||
      currentUrl.includes("/login")
    ) {
      console.log("");
      console.log(
        "You still appear to be on a login page. Make sure the sign-in fully completed before saving the session.",
      );
      const confirmation = await rl.question(
        "Type 'save' to save anyway, or just press Enter to cancel: ",
      );
      if (confirmation.trim().toLowerCase() !== "save") {
        console.log("Session save cancelled.");
        return;
      }
    }

    await context.storageState({
      path: storageStatePath,
    });

    console.log("");
    console.log(`Saved authenticated session to: ${storageStatePath}`);
    console.log(
      "You can now reuse this file in Playwright browser contexts instead of logging in every run.",
    );
  } finally {
    await browser.close();
    rl.close();
  }
};

main().catch((error) => {
  console.error("");
  console.error("Failed to save the Submittable session.");
  console.error(error);
  rl.close();
  process.exit(1);
});
