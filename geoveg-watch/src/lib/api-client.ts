import type { AreaHistoryResponse, AreaPolygon, ApiErrorBody, GeocodeResult } from "@/types";
import { AreaHistoryError } from "@/types";
import { getSessionId } from "@/lib/session";

/**
 * Base URL of the FastAPI backend. Configure via NEXT_PUBLIC_API_BASE_URL for
 * non-local deployments (e.g. when the backend runs as a separate service/container).
 * Defaults to localhost:8000 for local development (docker-compose / `uvicorn` directly).
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function parseErrorBody(response: Response): Promise<AreaHistoryError> {
  let body: ApiErrorBody | null = null;
  try {
    body = await response.json();
  } catch {
    // ignore parse failure; fall back to generic message below
  }
  const message = body?.error?.message ?? `Request failed with status ${response.status}.`;
  const code = body?.error?.code ?? "UNKNOWN_ERROR";
  return new AreaHistoryError(message, code, response.status);
}

export async function fetchAreaHistory(
  polygon: AreaPolygon,
  fromYear?: number,
  toYear?: number
): Promise<AreaHistoryResponse> {
  const response = await fetch(`${API_BASE_URL}/api/area-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": getSessionId(),
    },
    body: JSON.stringify({ polygon, fromYear, toYear }),
  });

  if (!response.ok) {
    throw await parseErrorBody(response);
  }
  return (await response.json()) as AreaHistoryResponse;
}

export async function fetchGeocodeResults(query: string): Promise<GeocodeResult[]> {
  const response = await fetch(`${API_BASE_URL}/api/geocode?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw await parseErrorBody(response);
  }
  const data = (await response.json()) as { results: GeocodeResult[] };
  return data.results;
}
