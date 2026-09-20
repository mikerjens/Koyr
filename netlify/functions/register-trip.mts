// Koyr mobilregistrering · all contexts
const LOCATIONS = new Set(["Hoyvík", "Giljanes", "Sørvágur"]);
const CARS = new Set(["BP311", "FA838", "DV871"]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, message: "Metoden er ikke tilladt." }, 405);
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://koyr.netlify.app") {
    return json({ ok: false, message: "Forespørgslen blev afvist." }, 403);
  }

  let payload: Record<string, unknown>;

  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, message: "Ugyldige oplysninger." }, 400);
  }

  const date = String(payload.date || "").trim();
  const from = String(payload.from || "").trim();
  const to = String(payload.to || "").trim();
  const car = String(payload.car || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ ok: false, message: "Vælg en gyldig dato." }, 400);
  }
  if (!LOCATIONS.has(from) || !LOCATIONS.has(to)) {
    return json({ ok: false, message: "Vælg gyldige steder." }, 400);
  }
  if (from === to) {
    return json({ ok: false, message: "Fra og til kan ikke være det samme sted." }, 400);
  }
  if (!CARS.has(car)) {
    return json({ ok: false, message: "Vælg en gyldig bil." }, 400);
  }

  const scriptUrl = Netlify.env.get("GOOGLE_SCRIPT_URL");

  if (!scriptUrl) {
    return json({
      ok: false,
      message: "Forbindelsen til arbejdsarket er ikke konfigureret."
    }, 503);
  }

  try {
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, from, to, car }),
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });

    const text = await response.text();
    let result: Record<string, unknown>;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error("Google returnerede et ugyldigt svar.");
    }

    if (!response.ok || result.ok !== true) {
      throw new Error(String(result.message || "Turen kunne ikke gemmes."));
    }

    return json(result);
  } catch (error) {
    console.error("Registrering fejlede", error);
    return json({
      ok: false,
      message: error instanceof Error
        ? error.message
        : "Turen kunne ikke gemmes."
    }, 502);
  }
};

export const config = {
  path: "/api/register-trip"
};
