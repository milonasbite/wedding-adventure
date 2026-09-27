import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const LOCAL_KEY = "wedding-adventure-local-scores-v1";
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
const client = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function cleanName(name) {
  return String(name || "Guest")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20) || "Guest";
}

function nameKey(name) {
  return cleanName(name).toLocaleLowerCase();
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(scores) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(scores.slice(0, 100)));
}

function isBetterScore(candidate, existing) {
  if (!existing) return true;
  if (candidate.score !== existing.score) return candidate.score > existing.score;
  return candidate.time_seconds < existing.time_seconds;
}

function uniqueBestScores(scores) {
  const best = new Map();

  for (const row of scores || []) {
    const key = nameKey(row.player_name);
    const previous = best.get(key);
    if (isBetterScore(row, previous)) best.set(key, row);
  }

  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.time_seconds - b.time_seconds
  );
}

export function isOnlineLeaderboardConfigured() {
  return configured;
}

export async function submitScore(result) {
  const playerName = cleanName(result.playerName);
  const payload = {
    player_name: playerName,
    player_key: nameKey(playerName),
    score: Math.max(0, Math.round(result.score)),
    time_seconds: Number(result.timeSeconds.toFixed(2)),
    rings: Math.max(0, result.rings | 0),
    hearts: Math.max(0, result.hearts | 0)
  };

  if (!configured) {
    const scores = readLocal();
    const index = scores.findIndex((row) => nameKey(row.player_name) === payload.player_key);

    if (index === -1) {
      scores.push({ ...payload, created_at: new Date().toISOString() });
    } else if (isBetterScore(payload, scores[index])) {
      scores[index] = { ...payload, created_at: new Date().toISOString() };
    }

    writeLocal(uniqueBestScores(scores));
    return { mode: "local" };
  }

  const { error } = await client.rpc("submit_wedding_score", {
    p_player_name: payload.player_name,
    p_player_key: payload.player_key,
    p_score: payload.score,
    p_time_seconds: payload.time_seconds,
    p_rings: payload.rings,
    p_hearts: payload.hearts
  });

  if (error) throw error;
  return { mode: "supabase" };
}

export async function getLeaderboard(limit = 10) {
  if (!configured) {
    return uniqueBestScores(readLocal()).slice(0, limit);
  }

  // Fetch extra rows so this remains correct even before an older database
  // has been migrated to the unique-name schema.
  const { data, error } = await client
    .from("wedding_scores")
    .select("player_name,score,time_seconds,rings,hearts,created_at")
    .order("score", { ascending: false })
    .order("time_seconds", { ascending: true })
    .limit(Math.max(limit * 10, 100));

  if (error) throw error;
  return uniqueBestScores(data || []).slice(0, limit);
}
