import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import {
  computeStandings,
  generateSwissPairings,
  generateBracketRound1,
  advanceBracketRound,
  bracketRoundCount,
  suggestedSwissRounds,
} from "../lib/tournamentPairing.js";

const router = Router();

const FORMATS = new Set(["swiss", "swiss_topcut", "single_elim"]);
const VALID_TOP_CUT_SIZES = new Set([2, 4, 8, 16]);
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

function isOrganizerOrAdmin(req, tournament) {
  return req.user && (req.user.id === tournament.organizer_id || req.user.role === "admin");
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Carrega jogadores + partidas de um torneio direto do banco, no formato
 * que o módulo puro de pareamento (tournamentPairing.js) espera.
 */
function loadEngineData(db, tournamentId) {
  const players = db
    .prepare("SELECT id, had_bye FROM tournament_players WHERE tournament_id = ? AND dropped = 0")
    .all(tournamentId)
    .map((p) => ({ id: p.id, hadBye: !!p.had_bye }));

  const matches = db
    .prepare(
      `SELECT tm.player1_id, tm.player2_id, tm.result, tm.bracket_slot, tm.round_id, tr.round_number, tr.stage
       FROM tournament_matches tm
       JOIN tournament_rounds tr ON tr.id = tm.round_id
       WHERE tm.tournament_id = ?
       ORDER BY tr.round_number ASC`
    )
    .all(tournamentId)
    .map((m) => ({
      player1Id: m.player1_id,
      player2Id: m.player2_id,
      result: m.result,
      bracketSlot: m.bracket_slot,
      roundId: m.round_id,
      roundNumber: m.round_number,
      stage: m.stage,
    }));

  return { players, matches };
}

function insertRound(db, tournamentId, roundNumber, stage) {
  const result = db
    .prepare(
      "INSERT INTO tournament_rounds (tournament_id, round_number, stage) VALUES (?, ?, ?)"
    )
    .run(tournamentId, roundNumber, stage);
  return result.lastInsertRowid;
}

function insertMatches(db, tournamentId, roundId, matches) {
  const insert = db.prepare(
    `INSERT INTO tournament_matches
       (tournament_id, round_id, bracket_slot, table_number, player1_id, player2_id, result)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  matches.forEach((match, index) => {
    insert.run(
      tournamentId,
      roundId,
      match.bracketSlot ?? null,
      index + 1,
      match.player1Id,
      match.player2Id,
      match.result
    );
  });
}

/**
 * Distribui pontos para todos os participantes ao finalizar um torneio.
 * Regras:
 *   - Vitória em partida: +3 pontos
 *   - Empate em partida: +1 ponto
 *   - Bônus Campeão: +10 pontos
 * Apenas torneios com is_official = 1 geram pontos para o ranking global.
 */
function distributePoints(db, tournament) {
  if (!tournament.is_official) return;

  const insertPt = db.prepare(
    "INSERT INTO point_history (user_id, tournament_id, points_awarded, reason) VALUES (?, ?, ?, ?)"
  );

  // Get all matches for this tournament with player info
  const allMatches = db.prepare(
    `SELECT tm.*, tp1.user_id AS user1_id, tp2.user_id AS user2_id
     FROM tournament_matches tm
     LEFT JOIN tournament_players tp1 ON tp1.id = tm.player1_id
     LEFT JOIN tournament_players tp2 ON tp2.id = tm.player2_id
     WHERE tm.tournament_id = ? AND tm.result != 'pending'`
  ).all(tournament.id);

  // Award match points
  for (const match of allMatches) {
    if (match.result === "bye") {
      // Bye counts as a win for player1
      if (match.user1_id) {
        insertPt.run(match.user1_id, tournament.id, 3, "Vitória (bye)");
      }
    } else if (match.result === "player1") {
      if (match.user1_id) {
        insertPt.run(match.user1_id, tournament.id, 3, "Vitória em partida");
      }
    } else if (match.result === "player2") {
      if (match.user2_id) {
        insertPt.run(match.user2_id, tournament.id, 3, "Vitória em partida");
      }
    } else if (match.result === "draw") {
      if (match.user1_id) {
        insertPt.run(match.user1_id, tournament.id, 1, "Empate em partida");
      }
      if (match.user2_id) {
        insertPt.run(match.user2_id, tournament.id, 1, "Empate em partida");
      }
    }
  }

  // Determine champion: winner of the last bracket match, or #1 in standings for swiss
  const { players: enginePlayers, matches: engineMatches } = loadEngineData(db, tournament.id);
  const standings = computeStandings(enginePlayers, engineMatches);

  if (standings.length > 0) {
    const championPlayerId = standings[0].playerId;
    const champion = db.prepare(
      "SELECT user_id FROM tournament_players WHERE id = ?"
    ).get(championPlayerId);
    if (champion) {
      insertPt.run(champion.user_id, tournament.id, 10, "Campeão do torneio");
    }
  }
}

/* ============================================================
   LISTAR / CRIAR
   ============================================================ */

router.get("/", optionalAuth, (req, res) => {
  const rows = req.db
    .prepare(
      `SELECT t.*, u.username AS organizer_username,
              (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS player_count
       FROM tournaments t
       JOIN users u ON u.id = t.organizer_id
       ORDER BY t.created_at DESC
       LIMIT 100`
    )
    .all();
  res.json(rows);
});

router.post("/", requireAuth, (req, res) => {
  const { name, description, format, top_cut_size, max_players, is_official } = req.body || {};

  if (!name || typeof name !== "string" || !name.trim() || name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: `Nome é obrigatório (máx. ${MAX_NAME_LENGTH} caracteres).` });
  }
  if (!FORMATS.has(format)) {
    return res.status(400).json({ error: "Formato inválido." });
  }
  if (format === "swiss_topcut" && !VALID_TOP_CUT_SIZES.has(top_cut_size)) {
    return res.status(400).json({ error: "Escolha um top cut válido (2, 4, 8 ou 16)." });
  }
  if (max_players !== undefined && max_players !== null) {
    if (!Number.isInteger(max_players) || max_players < 2 || max_players > 512) {
      return res.status(400).json({ error: "Número máximo de jogadores inválido." });
    }
  }
  const safeDescription =
    typeof description === "string" ? description.slice(0, MAX_DESCRIPTION_LENGTH) : "";

  // Only admins can create official tournaments
    const official = (is_official && req.user.role === "admin") ? 1 : 0;

    const result = req.db
    .prepare(
      `INSERT INTO tournaments (name, description, format, top_cut_size, max_players, organizer_id, is_official)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      safeDescription,
      format,
      format === "swiss_topcut" ? top_cut_size : null,
      max_players ?? null,
      req.user.id,
      official
    );

  res.status(201).json({ id: result.lastInsertRowid, message: "Torneio criado!" });
});

/* ============================================================
   DETALHE
   ============================================================ */

router.get("/:id", optionalAuth, (req, res) => {
  const tournament = req.db
    .prepare(
      `SELECT t.*, u.username AS organizer_username
       FROM tournaments t JOIN users u ON u.id = t.organizer_id
       WHERE t.id = ?`
    )
    .get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });

  const players = req.db
    .prepare(
      `SELECT tp.id, tp.user_id, u.username, tp.deck_id, cd.name AS deck_name,
              cd.alter_ego_id, tp.dropped, tp.had_bye
       FROM tournament_players tp
       JOIN users u ON u.id = tp.user_id
       JOIN community_decks cd ON cd.id = tp.deck_id
       WHERE tp.tournament_id = ?
       ORDER BY tp.joined_at ASC`
    )
    .all(tournament.id);

  const rounds = req.db
    .prepare(
      "SELECT id, round_number, stage, status FROM tournament_rounds WHERE tournament_id = ? ORDER BY round_number ASC"
    )
    .all(tournament.id);

  const matchRows = req.db
    .prepare(
      `SELECT tm.*, tr.round_number, tr.stage
       FROM tournament_matches tm JOIN tournament_rounds tr ON tr.id = tm.round_id
       WHERE tm.tournament_id = ?
       ORDER BY tr.round_number ASC, tm.table_number ASC`
    )
    .all(tournament.id);

  const usernameByPlayerId = new Map(players.map((p) => [p.id, p.username]));
  const matches = matchRows.map((m) => ({
    id: m.id,
    roundNumber: m.round_number,
    stage: m.stage,
    tableNumber: m.table_number,
    bracketSlot: m.bracket_slot,
    player1Id: m.player1_id,
    player2Id: m.player2_id,
    player1Name: m.player1_id ? usernameByPlayerId.get(m.player1_id) : null,
    player2Name: m.player2_id ? usernameByPlayerId.get(m.player2_id) : null,
    result: m.result,
    reportedBy: m.reported_by,
  }));

  const { players: enginePlayers, matches: engineMatches } = loadEngineData(req.db, tournament.id);
  const standings = computeStandings(enginePlayers, engineMatches).map((row) => ({
    ...row,
    username: usernameByPlayerId.get(row.playerId) || "?",
  }));

  res.json({
    ...tournament,
    isOrganizer: !!(req.user && req.user.id === tournament.organizer_id),
    isAdmin: !!(req.user && req.user.role === "admin"),
    myRegistration: req.user ? players.find((p) => p.user_id === req.user.id) || null : null,
    players,
    rounds,
    matches,
    standings,
  });
});

/* ============================================================
   INSCRIÇÃO
   ============================================================ */

router.post("/:id/register", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (tournament.status !== "inscricao") {
    return res.status(409).json({ error: "As inscrições desse torneio já fecharam." });
  }

  const { deck_id } = req.body || {};
  const deck = req.db
    .prepare("SELECT * FROM community_decks WHERE id = ? AND user_id = ?")
    .get(deck_id, req.user.id);
  if (!deck) {
    return res.status(400).json({ error: "Escolha um deck seu já publicado na comunidade." });
  }

  const alreadyRegistered = req.db
    .prepare("SELECT id FROM tournament_players WHERE tournament_id = ? AND user_id = ?")
    .get(tournament.id, req.user.id);
  if (alreadyRegistered) {
    return res.status(409).json({ error: "Você já está inscrito nesse torneio." });
  }

  if (tournament.max_players) {
    const count = req.db
      .prepare("SELECT COUNT(*) AS count FROM tournament_players WHERE tournament_id = ?")
      .get(tournament.id).count;
    if (count >= tournament.max_players) {
      return res.status(409).json({ error: "Esse torneio já atingiu o número máximo de jogadores." });
    }
  }

  req.db
    .prepare("INSERT INTO tournament_players (tournament_id, user_id, deck_id) VALUES (?, ?, ?)")
    .run(tournament.id, req.user.id, deck_id);

  res.status(201).json({ message: "Inscrição confirmada!" });
});

router.delete("/:id/register", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (tournament.status !== "inscricao") {
    return res.status(409).json({
      error: "O torneio já começou — use a opção de dar drop em vez de cancelar a inscrição.",
    });
  }

  req.db
    .prepare("DELETE FROM tournament_players WHERE tournament_id = ? AND user_id = ?")
    .run(tournament.id, req.user.id);

  res.json({ message: "Inscrição cancelada." });
});

router.post("/:id/drop", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });

  // Alguém pode dar drop de si mesmo; o organizador (ou admin) pode dar
  // drop de qualquer inscrito (ex: no-show).
  const { player_id } = req.body || {};
  const target = player_id
    ? req.db.prepare("SELECT * FROM tournament_players WHERE id = ? AND tournament_id = ?").get(player_id, tournament.id)
    : req.db.prepare("SELECT * FROM tournament_players WHERE tournament_id = ? AND user_id = ?").get(tournament.id, req.user.id);

  if (!target) return res.status(404).json({ error: "Inscrição não encontrada." });
  if (target.user_id !== req.user.id && !isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Você só pode dar drop da sua própria inscrição." });
  }

  req.db.prepare("UPDATE tournament_players SET dropped = 1 WHERE id = ?").run(target.id);
  res.json({ message: "Drop registrado." });
});

/* ============================================================
   INICIAR TORNEIO / GERAR RODADAS
   ============================================================ */

router.post("/:id/start", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (!isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Só o organizador pode iniciar o torneio." });
  }
  if (tournament.status !== "inscricao") {
    return res.status(409).json({ error: "Esse torneio já foi iniciado." });
  }

  const players = req.db
    .prepare("SELECT id FROM tournament_players WHERE tournament_id = ? AND dropped = 0")
    .all(tournament.id);
  if (players.length < 2) {
    return res.status(400).json({ error: "É preciso de pelo menos 2 jogadores inscritos." });
  }

  const shuffled = shuffle(players);
  let roundCount;
  let matches;
  let stage;

  if (tournament.format === "single_elim") {
    roundCount = bracketRoundCount(players.length);
    matches = generateBracketRound1(shuffled);
    stage = "topcut";
  } else {
    roundCount = suggestedSwissRounds(players.length);
    const standings = computeStandings(shuffled.map((p) => ({ id: p.id })), []);
    matches = generateSwissPairings(
      shuffled.map((p) => ({ id: p.id, hadBye: false })),
      [],
      standings
    );
    stage = "swiss";
  }

  const roundId = insertRound(req.db, tournament.id, 1, stage);
  insertMatches(req.db, tournament.id, roundId, matches);

  // Marca quem tirou bye nessa rodada (usado nas próximas pra não repetir).
  matches
    .filter((m) => m.result === "bye")
    .forEach((m) => {
      req.db.prepare("UPDATE tournament_players SET had_bye = 1 WHERE id = ?").run(m.player1Id);
    });

  req.db
    .prepare(
      `UPDATE tournaments SET status = 'em_andamento', current_round = 1, round_count = ?,
       started_at = datetime('now') WHERE id = ?`
    )
    .run(roundCount, tournament.id);

  res.json({ message: "Torneio iniciado!", round: 1 });
});

router.post("/:id/next-round", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (!isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Só o organizador pode avançar de rodada." });
  }
  if (tournament.status !== "em_andamento") {
    return res.status(409).json({ error: "Esse torneio não está em andamento." });
  }

  const currentRound = req.db
    .prepare("SELECT * FROM tournament_rounds WHERE tournament_id = ? AND round_number = ?")
    .get(tournament.id, tournament.current_round);

  const currentMatches = req.db
    .prepare("SELECT * FROM tournament_matches WHERE round_id = ?")
    .all(currentRound.id);
  if (currentMatches.some((m) => m.result === "pending")) {
    return res.status(409).json({ error: "Ainda há confrontos sem resultado nessa rodada." });
  }

  const isBracketStage = currentRound.stage === "topcut";
  const nextRoundNumber = tournament.current_round + 1;

  if (isBracketStage) {
    if (currentMatches.length === 1) {
      // A final acabou de ser decidida — torneio encerrado.
      req.db
        .prepare("UPDATE tournaments SET status = 'finalizado', finished_at = datetime('now') WHERE id = ?")
        .run(tournament.id);
      distributePoints(req.db, tournament);
      return res.json({ message: "Torneio finalizado!", finished: true });
    }
    const nextMatches = advanceBracketRound(
      currentMatches.map((m) => ({
        player1Id: m.player1_id,
        player2Id: m.player2_id,
        result: m.result,
        bracketSlot: m.bracket_slot,
      }))
    );
    const roundId = insertRound(req.db, tournament.id, nextRoundNumber, "topcut");
    insertMatches(req.db, tournament.id, roundId, nextMatches);
    req.db.prepare("UPDATE tournaments SET current_round = ? WHERE id = ?").run(nextRoundNumber, tournament.id);
    return res.json({ message: `Rodada ${nextRoundNumber} gerada.`, round: nextRoundNumber });
  }

  // Fase suíça
  if (tournament.current_round >= tournament.round_count) {
    if (tournament.format === "swiss_topcut") {
      return res.status(409).json({
        error: "A fase suíça já terminou — use \"Avançar para mata-mata\" em vez de próxima rodada.",
      });
    }
    req.db
      .prepare("UPDATE tournaments SET status = 'finalizado', finished_at = datetime('now') WHERE id = ?")
      .run(tournament.id);
    distributePoints(req.db, tournament);
    return res.json({ message: "Torneio finalizado!", finished: true });
  }

  const { players: enginePlayers, matches: engineMatches } = loadEngineData(req.db, tournament.id);
  const activePlayers = req.db
    .prepare("SELECT id, had_bye FROM tournament_players WHERE tournament_id = ? AND dropped = 0")
    .all(tournament.id)
    .map((p) => ({ id: p.id, hadBye: !!p.had_bye }));
  const standings = computeStandings(enginePlayers, engineMatches);

  const nextMatches = generateSwissPairings(activePlayers, engineMatches, standings);
  const roundId = insertRound(req.db, tournament.id, nextRoundNumber, "swiss");
  insertMatches(req.db, tournament.id, roundId, nextMatches);

  nextMatches
    .filter((m) => m.result === "bye")
    .forEach((m) => {
      req.db.prepare("UPDATE tournament_players SET had_bye = 1 WHERE id = ?").run(m.player1Id);
    });

  req.db.prepare("UPDATE tournaments SET current_round = ? WHERE id = ?").run(nextRoundNumber, tournament.id);
  res.json({ message: `Rodada ${nextRoundNumber} gerada.`, round: nextRoundNumber });
});

router.post("/:id/start-topcut", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (!isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Só o organizador pode avançar pro mata-mata." });
  }
  if (tournament.format !== "swiss_topcut") {
    return res.status(400).json({ error: "Esse torneio não tem fase de mata-mata." });
  }
  if (tournament.current_round < tournament.round_count) {
    return res.status(409).json({ error: "A fase suíça ainda não terminou." });
  }

  const currentRound = req.db
    .prepare("SELECT * FROM tournament_rounds WHERE tournament_id = ? AND round_number = ?")
    .get(tournament.id, tournament.current_round);
  const currentMatches = req.db.prepare("SELECT * FROM tournament_matches WHERE round_id = ?").all(currentRound.id);
  if (currentMatches.some((m) => m.result === "pending")) {
    return res.status(409).json({ error: "Ainda há confrontos sem resultado na última rodada suíça." });
  }

  const { players: enginePlayers, matches: engineMatches } = loadEngineData(req.db, tournament.id);
  const standings = computeStandings(enginePlayers, engineMatches);
  const cutPlayers = standings.slice(0, tournament.top_cut_size).map((s) => ({ id: s.playerId }));

  if (cutPlayers.length < 2) {
    return res.status(400).json({ error: "Jogadores insuficientes para o corte definido." });
  }

  const nextRoundNumber = tournament.current_round + 1;
  const matches = generateBracketRound1(cutPlayers);
  const roundId = insertRound(req.db, tournament.id, nextRoundNumber, "topcut");
  insertMatches(req.db, tournament.id, roundId, matches);

  req.db.prepare("UPDATE tournaments SET current_round = ? WHERE id = ?").run(nextRoundNumber, tournament.id);
  res.json({ message: "Mata-mata iniciado!", round: nextRoundNumber });
});

/* ============================================================
   REPORTAR RESULTADO
   ============================================================ */

router.post("/:id/matches/:matchId/report", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });

  const match = req.db
    .prepare("SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?")
    .get(req.params.matchId, tournament.id);
  if (!match) return res.status(404).json({ error: "Confronto não encontrado." });
  if (match.result === "bye") {
    return res.status(400).json({ error: "Confronto de bye não precisa de resultado." });
  }

  const { result } = req.body || {};
  if (!["player1", "player2", "draw"].includes(result)) {
    return res.status(400).json({ error: "Resultado inválido." });
  }

  const isPlayerInMatch = req.db
    .prepare(
      "SELECT id FROM tournament_players WHERE id IN (?, ?) AND user_id = ?"
    )
    .get(match.player1_id, match.player2_id, req.user.id);

  if (!isPlayerInMatch && !isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Só os jogadores do confronto ou o organizador podem reportar." });
  }

  req.db
    .prepare("UPDATE tournament_matches SET result = ?, reported_by = ? WHERE id = ?")
    .run(result, req.user.id, match.id);

  res.json({ message: "Resultado registrado." });
});

/* ============================================================
   CANCELAR
   ============================================================ */

router.post("/:id/cancel", requireAuth, (req, res) => {
  const tournament = req.db.prepare("SELECT * FROM tournaments WHERE id = ?").get(req.params.id);
  if (!tournament) return res.status(404).json({ error: "Torneio não encontrado." });
  if (!isOrganizerOrAdmin(req, tournament)) {
    return res.status(403).json({ error: "Só o organizador pode cancelar o torneio." });
  }
  req.db.prepare("UPDATE tournaments SET status = 'cancelado' WHERE id = ?").run(tournament.id);
  res.json({ message: "Torneio cancelado." });
});

export default router;
