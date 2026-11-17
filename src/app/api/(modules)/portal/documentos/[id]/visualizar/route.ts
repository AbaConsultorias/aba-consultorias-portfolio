import { visualizar } from "./service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return visualizar(request, await params);
}
