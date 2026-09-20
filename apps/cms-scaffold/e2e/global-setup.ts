import { API } from "./helpers";

export default async function globalSetup() {
  const response = await fetch(`${API}/actuator/health`);
  if (!response.ok) {
    throw new Error(
      `API ${API} is not healthy (${response.status}). Start the stack with: docker compose -f compose.yaml up --wait --build`,
    );
  }
}
