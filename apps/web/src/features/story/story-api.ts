import {
  ERROR_COPY,
  ErrorCode,
  storyPaths,
  type StoryDirectorRequest,
  type StoryDirectorResponse,
  type StoryTokenResponse,
} from "@symptomsketch/contracts";
import { ApiClientError } from "@/lib/api";

async function failure(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown };
    const parsed = ErrorCode.safeParse(body.code);
    if (parsed.success) {
      return new ApiClientError(
        parsed.data,
        typeof body.message === "string" ? body.message : ERROR_COPY[parsed.data],
        res.status,
      );
    }
  } catch {
    // non-JSON body
  }
  return new ApiClientError("INTERNAL_ERROR", ERROR_COPY.INTERNAL_ERROR, res.status);
}

export async function storyFetch<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server.", 0);
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as T;
}

const postJson = <T>(url: string, body: unknown, signal?: AbortSignal) =>
  storyFetch<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

export const getStoryToken = (caseId: string) =>
  postJson<StoryTokenResponse>(storyPaths.token(caseId), {});

export const askDirector = (caseId: string, req: StoryDirectorRequest, signal?: AbortSignal) =>
  postJson<StoryDirectorResponse>(storyPaths.director(caseId), req, signal);

/** The case's own normalized product photo (owner-authorized media URL). */
export async function fetchPhoto(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not load your product photo.", 0);
  }
  if (!res.ok) throw await failure(res);
  return res.blob();
}
