/* Opening a browser, and saying something useful when it can't be opened.
 *
 * Four suites drive a real browser. Each of them used to begin
 *
 *   import { chromium } from 'playwright';
 *
 * which, on a machine where playwright is not installed, fails before a single
 * line of the suite runs and prints a forty-line Node stack trace ending in
 * ERR_MODULE_NOT_FOUND. That is a true statement about module resolution and
 * tells you nothing about what to do next.
 *
 * Worse, it was my mistake that put it there: playwright was installed in the
 * container I run these in and never added to package.json, so `npm install`
 * on anybody else's machine — including the one this project is developed on —
 * installed everything except the one thing four of the eleven suites need.
 * It is a declared devDependency now.
 *
 * There are two separate ways this still goes wrong, and they need different
 * answers:
 *
 *  - the package isn't there. `npm install`.
 *  - the package is there but the browser it drives isn't. This is the normal
 *    state on a machine whose npm blocks install scripts (`allowScripts`),
 *    because downloading Chromium *is* playwright's install script. The fix is
 *    a separate, explicit `npx playwright install chromium` — about 150MB.
 *
 * Both are ordinary setup, not failures of the code under test, so both exit
 * with instructions rather than a stack trace.
 */

const ADVICE = `
  These four suites drive a real browser, so they need playwright:

    npm install                       (it is a devDependency)
    npx playwright install chromium   (the browser itself, ~150MB — separate
                                       because npm here blocks install scripts)

  Then, with the site running in another window:

    npm run test:mobile
    npm run test:flows

  If you would rather not keep a browser download on this machine, these are
  fine to leave to me — like npm run test:qr, which needs python. The suites
  that need nothing but node are:

    npm run test:validate   npm run test:money
    npm run test:auth       npm run test:stripe
`;

export async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    console.log("\n  playwright is not installed.");
    console.log(ADVICE);
    process.exit(1);
  }

  try {
    return await chromium.launch(
      process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    );
  } catch (err) {
    const message = String(err?.message ?? err);
    /* playwright's own wording for a missing browser binary. Matched loosely
       because it has changed across versions and this is a signpost, not a
       contract — anything else is re-thrown so a real launch failure still
       shows its own error. */
    if (!/Executable doesn't exist|browserType\.launch.*install/is.test(message)) throw err;
    console.log("\n  playwright is installed, but its browser has not been downloaded.");
    console.log(ADVICE);
    process.exit(1);
  }
}
