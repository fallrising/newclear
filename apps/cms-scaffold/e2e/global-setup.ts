import { ADMIN, API, BACK, FRONT, waitForHttp } from "./helpers";
import { prepareOwnedAudit, prepareOwnedMember, requireOwnedLocalProject } from "./prepare-owned";

export default async function globalSetup() {
  if (!/^cms-w5-e2e-\d+-[0-9a-f]{16}$/.test(process.env.CMS_E2E_PROJECT || "")) throw new Error("Real API tests require the disposable runner: npm run e2e");
  requireOwnedLocalProject(process.env.CMS_E2E_PROJECT);
  for (const url of [`${API}/actuator/health`, FRONT, BACK, ADMIN]) await waitForHttp(url);
  await prepareOwnedMember(process.env.CMS_E2E_PROJECT);
  process.env.CMS_E2E_AUDIT_TARGET_ID = await prepareOwnedAudit(process.env.CMS_E2E_PROJECT);
}
