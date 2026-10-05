import { ADMIN, API, BACK, FRONT, waitForHttp } from "./helpers";
import { prepareOwnedMember } from "./prepare-owned";

export default async function globalSetup() {
  if (!/^cms-w5-e2e-\d+-[0-9a-f]{16}$/.test(process.env.CMS_E2E_PROJECT || "")) throw new Error("Real API tests require the disposable runner: npm run e2e");
  for (const url of [`${API}/actuator/health`, FRONT, BACK, ADMIN]) await waitForHttp(url);
  await prepareOwnedMember(process.env.CMS_E2E_PROJECT);
}
