const API_BASE_URL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "http://localhost:5000";

type ApiOptions = RequestInit & {
  parseJson?: boolean;
};

const isJsonResponse = (response: Response) => {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.includes("application/json");
};

export async function apiFetch<T>(path: string, options: ApiOptions = {}) {
  const { parseJson = true, ...init } = options;
  const requestInit: RequestInit = { ...init };
  const headers = new Headers(init.headers);

  const hasBody = requestInit.body !== undefined;
  const isFormData = hasBody && requestInit.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  requestInit.headers = headers;

  const response = await fetch(`${API_BASE_URL}${path}`, requestInit);

  let payload: unknown = null;
  const shouldParse = parseJson && isJsonResponse(response);

  if (shouldParse) {
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok) {
        payload = null;
      } else {
        throw error;
      }
    }
  }

  if (!response.ok) {
    const message =
      typeof (payload as Record<string, unknown>)?.error === "string"
        ? ((payload as Record<string, string>).error ?? "")
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export { API_BASE_URL };

