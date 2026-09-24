import { GET as catchAllGet } from "./[...path]/route";

/** GET /api/cart (the catch-all needs at least one segment). */
export async function GET(req: Request) {
  return catchAllGet(req, { params: Promise.resolve({ path: [] }) });
}
