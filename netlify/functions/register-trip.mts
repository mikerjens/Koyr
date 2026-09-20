// Koyr mobilregistrering og oversigt
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

function normalizeSheetDate(value: unknown) {
  const text = String(value || "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) {
    return "";
  }

  return [match[3], match[2].padStart(2, "0"), match[1].padStart(2, "0")].join("-");
}

function extractValues(input: unknown): unknown[][] {
  let current = input;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current);
        continue;
      } catch {
        return [];
      }
    }

    if (!current || typeof current !== "object") {
      return [];
    }

    const record = current as Record<string, unknown>;

    if (Array.isArray(record.values)) {
      return record.values.filter(Array.isArray);
    }

    if ("body" in record) {
      current = record.body;
      continue;
    }

    return [];
  }

  return [];
}

async function readSheetRows() {
  const listUrl = Netlify.env.get("GOOGLE_LIST_URL");

  if (!listUrl) {
    throw new Error("Læseforbindelsen til arbejdsarket er ikke konfigureret.");
  }

  const response = await fetch(listUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error("Arbejdsarket kunne ikke læses.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Arbejdsarket returnerede et ugyldigt svar.");
  }

  return extractValues(parsed).map((row) => row.map((cell) => String(cell ?? "").trim()));
}

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, message: "Metoden er ikke tilladt." }, 405);
  }

  const origin = req.headers.get("origin");
  if (origin && origin !== "https://koyr.netlify.app") {
    return json({ ok: false, message: "Forespørgslen blev afvist." }, 403);
  }

  if (req.method === "GET") {
    const month = new URL(req.url).searchParams.get("month") || "";

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return json({ ok: false, message: "Vælg en gyldig måned." }, 400);
    }

    try {
      const rows = await readSheetRows();
      const counts = new Map<string, number>();

      for (const row of rows.slice(1)) {
        const date = normalizeSheetDate(row[0]);

        if (date.startsWith(month + "-")) {
          counts.set(date, (counts.get(date) || 0) + 1);
        }
      }

      const days = Array.from(counts, ([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return json({ ok: true, month, days });
    } catch (error) {
      console.error("Oversigten kunne ikke hentes", error);
      return json({
        ok: false,
        message: "De registrerede dage kunne ikke hentes lige nu."
      }, 502);
    }
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

  try {
    const rows = await readSheetRows();
    const duplicate = rows.slice(1).some((row) =>
      normalizeSheetDate(row[0]) === date &&
      row[1] === from &&
      row[2] === to &&
      row[3] === car
    );

    if (duplicate) {
      return json({
        ok: true,
        duplicate: true,
        message: "Turen var allerede registreret."
      });
    }
  } catch (error) {
    console.warn("Dobbeltkontrollen kunne ikke gennemføres", error);
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
