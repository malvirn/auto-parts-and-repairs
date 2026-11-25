const API_BASE_URL = "https://centric-api.malvirngomo8.workers.dev";

export async function verifyCentricApiSession({ accessToken, userId, role }) {
  if (!accessToken || !userId || !role) {
    return { ok: false, reason: "missing_session_context" };
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/me`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { ok: false, status: response.status, reason: "api_rejected_session" };
    }

    const payload = await response.json();
    const apiUser = payload?.user;
    if (apiUser?.id !== userId || apiUser?.role !== role) {
      return { ok: false, status: response.status, reason: "identity_or_role_mismatch" };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === "TimeoutError" ? "timeout" : "network_or_cors_error",
    };
  }
}
