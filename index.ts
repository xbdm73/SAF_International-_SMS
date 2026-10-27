// SAF International — reformulation des points d'audit par Claude (oct. 2026)
// Appelée par le CMS (bouton « Améliorer avec l'IA ») avec la session de l'utilisateur.
// Contrôles : utilisateur connecté, second facteur (aal2), rôle admin ou editor.
// Secret requis : ANTHROPIC_API_KEY. Facultatif : SAF_AI_MODEL (défaut claude-sonnet-5-5).
// Le contenu des exigences n'est jamais journalisé.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function jwtClaims(tok: string): Record<string, unknown> {
  try {
    let b = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    return JSON.parse(atob(b));
  } catch { return {}; }
}

const DEFAULT_WHO = [
  "Dirigeant responsable (ACM)", "Safety Manager", "CMM", "NPFO", "NPCT", "NPGO", "NPCA / CAMO",
  "Chef de base", "Formateurs / examinateurs", "Commandant de bord", "Équipage",
  "Personnel au sol / HESLO", "Maintenance", "Organisation (direction)", "Non attribué",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await sb.auth.getUser(token);
    const user = u?.user;
    if (!user?.email) return json({ error: "Session requise" }, 401);
    if (jwtClaims(token).aal !== "aal2") return json({ error: "Second facteur requis" }, 403);
    const { data: roles } = await sb.from("user_roles").select("role").ilike("user_email", user.email).limit(1);
    const role = String(roles?.[0]?.role ?? "").toLowerCase();
    if (role !== "admin" && role !== "editor") return json({ error: "Rôle non autorisé" }, 403);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "Secret ANTHROPIC_API_KEY absent" }, 500);

    const body = await req.json();
    const who: string[] = Array.isArray(body.who) && body.who.length ? body.who.map(String).slice(0, 30) : DEFAULT_WHO;
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 25).map((x: Record<string, unknown>) => ({
      id: String(x.id ?? ""), section: String(x.section ?? "").slice(0, 200),
      lead: String(x.lead ?? "").slice(0, 600), text: String(x.text ?? "").slice(0, 1500),
      kind: String(x.kind ?? "exigence"),
    })).filter((x: { id: string; text: string }) => x.id && x.text);
    if (!items.length) return json({ items: [] });

    const system =
      "Tu es auditeur de conformité aéronautique (EASA Part-ORO, CAT, SPO, SPA, CAMO) chez un exploitant d'hélicoptères AS 332 Super Puma " +
      "(transport, travail aérien HESLO, lutte contre les incendies). On te donne des exigences extraites d'un manuel interne. " +
      "Pour chacune, produis :\n" +
      "- q : UNE question d'audit fermée, vérifiable sur le terrain, qui reprend fidèlement l'exigence sans en changer la portée ni en ajouter. " +
      "Rédige-la dans la langue de l'exigence. Si l'exigence est une interdiction, demande si elle est respectée ; si c'est une recommandation, demande si elle est appliquée.\n" +
      "- ev : la preuve objective à demander ou à observer (document, enregistrement, échantillon, observation), en une phrase courte.\n" +
      "- who : la fonction à interroger, OBLIGATOIREMENT une valeur exacte de cette liste : " + JSON.stringify(who) + ".\n" +
      "Le champ « lead » éventuel est la phrase d'introduction d'une liste à puces dont « text » est l'une des puces.\n" +
      "Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour : {\"items\":[{\"id\":\"…\",\"q\":\"…\",\"ev\":\"…\",\"who\":\"…\"}]}";

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("SAF_AI_MODEL") ?? "claude-sonnet-5-5",
        max_tokens: 6000,
        system,
        messages: [{ role: "user", content: JSON.stringify({ items }) }],
      }),
    });
    if (!r.ok) return json({ error: "Service IA indisponible (" + r.status + ")" }, 502);
    const out = await r.json();
    const text = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
    const parsed = JSON.parse(clean.slice(start, end + 1));
    const valid = new Set(items.map((x: { id: string }) => x.id));
    const res = (parsed.items ?? []).filter((x: { id: string }) => valid.has(String(x.id))).map((x: Record<string, unknown>) => ({
      id: String(x.id), q: String(x.q ?? "").slice(0, 600), ev: String(x.ev ?? "").slice(0, 300),
      who: who.includes(String(x.who)) ? String(x.who) : "Non attribué",
    }));
    return json({ items: res });
  } catch (_e) {
    return json({ error: "Traitement impossible" }, 500);
  }
});
