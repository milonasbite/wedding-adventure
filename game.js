import { MAX_LEVEL_SECONDS } from "./config.js";
import { submitScore, getLeaderboard, isOnlineLeaderboardConfigured } from "./leaderboard.js";

const $ = (id) => document.getElementById(id);
const ui = {
  startOverlay: $("start-overlay"),
  endOverlay: $("end-overlay"),
  playerName: $("player-name"),
  startButton: $("start-game"),
  playAgain: $("play-again"),
  showLeaderboard: $("show-leaderboard"),
  leaderboardToggle: $("leaderboard-toggle"),
  leaderboardPanel: $("leaderboard-panel"),
  leaderboardList: $("leaderboard-list"),
  refreshLeaderboard: $("refresh-leaderboard"),
  startMessage: $("start-message"),
  submitMessage: $("submit-message"),
  leaderboardMessage: $("leaderboard-message"),
  scoreBreakdown: $("score-breakdown"),
  endBadge: $("end-badge"),
  endTitle: $("end-title"),
  hudScore: $("hud-score"),
  hudRings: $("hud-rings"),
  hudHearts: $("hud-hearts"),
  hudTime: $("hud-time"),
  joystickBase: $("joystick-base"),
  joystickKnob: $("joystick-knob"),
  jump: $("jump-btn"),
  fire: $("fire-btn"),
  hudFire: $("hud-fire"),
  hudSuper: $("hud-super"),
  hudLevel: $("hud-level"),
  musicToggle: $("music-toggle"),
  gameWrap: $("game-wrap"),
  hudStrip: document.querySelector(".hud-strip"),
  touchControls: $("touch-controls")
};

const touch = { moveX: 0, moveY: 0, jump: false, joystickJumpRequested: false };
const PLAYER_NAME_STORAGE_KEY = "weddingAdventurePlayerName";
const DEFAULT_PLAYER_NAME = "Aimilia";
let playerName = DEFAULT_PLAYER_NAME;
let sceneRef = null;
let joystickPointerId = null;
let joystickUpLatched = false;

// Wedding-style game music using an original looping audio track.
let musicAudio = null;
let musicEnabled = localStorage.getItem("weddingAdventureMusicMuted") !== "1";

function updateMusicButton() {
  if (!ui.musicToggle) return;
  ui.musicToggle.textContent = musicEnabled ? "♫" : "🔇";
  ui.musicToggle.classList.toggle("muted", !musicEnabled);
  ui.musicToggle.setAttribute("aria-label", musicEnabled ? "Mute game music" : "Turn game music on");
  ui.musicToggle.title = musicEnabled ? "Mute game music" : "Turn game music on";
}

function ensureMusicAudio() {
  if (!musicAudio) {
    musicAudio = new Audio("assets/wedding_theme.wav");
    musicAudio.loop = true;
    musicAudio.preload = "auto";
    musicAudio.volume = 0.42;
  }
  return musicAudio;
}

function startGameMusic() {
  updateMusicButton();
  if (!musicEnabled) return;
  const audio = ensureMusicAudio();
  if (!audio) return;
  try {
    if (audio.paused) {
      audio.currentTime = 0;
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  } catch (_) {}
}

function stopGameMusic() {
  if (!musicAudio) return;
  try {
    musicAudio.pause();
    musicAudio.currentTime = 0;
  } catch (_) {}
}

if (ui.musicToggle) {
  updateMusicButton();
  ui.musicToggle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    musicEnabled = !musicEnabled;
    localStorage.setItem("weddingAdventureMusicMuted", musicEnabled ? "0" : "1");
    if (musicEnabled && sceneRef?.running) startGameMusic();
    else if (!musicEnabled) stopGameMusic();
    updateMusicButton();
  });
}

function bindHold(button, key) {
  const down = (event) => {
    event.preventDefault();
    touch[key] = true;
    button.classList.add("pressed");
  };
  const up = (event) => {
    event.preventDefault();
    touch[key] = false;
    button.classList.remove("pressed");
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("pointerleave", up);
}

function updateJoystick(event) {
  if (!ui.joystickBase || !ui.joystickKnob) return;
  const rect = ui.joystickBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const max = Math.min(rect.width, rect.height) * 0.33;
  if (distance > max && distance > 0) {
    dx = (dx / distance) * max;
    dy = (dy / distance) * max;
  }
  ui.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

  const xAmount = dx / max;
  const yAmount = dy / max;
  const upAmount = -yAmount;

  // Use clear 8-way sectors rather than weakening horizontal movement
  // when the stick is pushed diagonally. Up-left / up-right therefore
  // produce full sideways movement while also requesting a single jump.
  const diagonalUp = upAmount > 0.35;
  if (diagonalUp && xAmount < -0.22) {
    touch.moveX = -1;
  } else if (diagonalUp && xAmount > 0.22) {
    touch.moveX = 1;
  } else if (Math.abs(xAmount) > 0.28) {
    touch.moveX = Math.sign(xAmount);
  } else {
    touch.moveX = 0;
  }

  // Keep a vertical joystick axis for superhero flight. This also means
  // down-left / down-right retain their horizontal component while flying.
  if (yAmount < -0.28) {
    touch.moveY = -1;
  } else if (yAmount > 0.28) {
    touch.moveY = 1;
  } else {
    touch.moveY = 0;
  }

  // Any upward sector (up, up-left or up-right) requests one normal jump.
  // It is latched so holding the stick upward cannot repeatedly jump when
  // the player is not in superhero mode.
  if (upAmount > 0.42 && !joystickUpLatched) {
    touch.joystickJumpRequested = true;
    joystickUpLatched = true;
  } else if (upAmount < 0.18) {
    joystickUpLatched = false;
  }
}

function resetJoystick() {
  joystickPointerId = null;
  touch.moveX = 0;
  touch.moveY = 0;
  touch.joystickJumpRequested = false;
  joystickUpLatched = false;
  if (ui.joystickKnob) ui.joystickKnob.style.transform = "translate(0px, 0px)";
}

if (ui.joystickBase) {
  ui.joystickBase.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    joystickPointerId = event.pointerId;
    ui.joystickBase.setPointerCapture?.(event.pointerId);
    updateJoystick(event);
  });
  ui.joystickBase.addEventListener("pointermove", (event) => {
    if (joystickPointerId !== event.pointerId) return;
    event.preventDefault();
    updateJoystick(event);
  });
  const endJoystick = (event) => {
    if (joystickPointerId !== null && joystickPointerId !== event.pointerId) return;
    event.preventDefault();
    resetJoystick();
  };
  ui.joystickBase.addEventListener("pointerup", endJoystick);
  ui.joystickBase.addEventListener("pointercancel", endJoystick);
  ui.joystickBase.addEventListener("lostpointercapture", resetJoystick);
}

bindHold(ui.jump, "jump");

ui.fire.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (sceneRef) sceneRef.fireFlamethrower();
});


function setGameUiActive(active) {
  ui.hudStrip.hidden = !active;
  ui.touchControls.hidden = !active;
  ui.gameWrap.classList.toggle("menu-mode", !active);
  document.body.classList.toggle("menu-open", !active);
  if (!active) resetJoystick();
}

function loadRememberedPlayerName() {
  try {
    const remembered = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    if (remembered) {
      playerName = remembered;
      ui.playerName.value = remembered;
      return;
    }
  } catch (error) {
    console.warn("Could not read remembered player name", error);
  }
  playerName = DEFAULT_PLAYER_NAME;
  ui.playerName.value = DEFAULT_PLAYER_NAME;
}

function rememberPlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
  } catch (error) {
    console.warn("Could not remember player name", error);
  }
}

function safeName() {
  return ui.playerName.value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

loadRememberedPlayerName();

async function renderLeaderboard() {
  ui.leaderboardMessage.textContent = "Loading…";
  try {
    const rows = await getLeaderboard(10);
    ui.leaderboardList.innerHTML = "";
    if (!rows.length) {
      ui.leaderboardList.innerHTML = "<li><span class='rank'>—</span><span class='player'>No scores yet</span><span class='points'>0</span></li>";
    } else {
      rows.forEach((row, index) => {
        const li = document.createElement("li");
        const rank = document.createElement("span");
        const name = document.createElement("span");
        const points = document.createElement("span");
        rank.className = "rank";
        name.className = "player";
        points.className = "points";
        rank.textContent = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `#${index + 1}`;
        name.textContent = row.player_name;
        points.textContent = Number(row.score).toLocaleString();
        li.append(rank, name, points);
        ui.leaderboardList.appendChild(li);
      });
    }
    ui.leaderboardMessage.textContent = isOnlineLeaderboardConfigured()
      ? "Live leaderboard"
      : "Local test mode — add Supabase credentials in config.js for a shared leaderboard.";
  } catch (error) {
    console.error(error);
    ui.leaderboardMessage.textContent = "Could not load leaderboard.";
  }
}

function toggleLeaderboard(force) {
  const shouldShow = typeof force === "boolean" ? force : ui.leaderboardPanel.hidden;
  ui.leaderboardPanel.hidden = !shouldShow;
  if (shouldShow) {
    renderLeaderboard();
    ui.leaderboardPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

ui.leaderboardToggle.addEventListener("click", () => toggleLeaderboard());
ui.showLeaderboard.addEventListener("click", () => toggleLeaderboard(true));
ui.refreshLeaderboard.addEventListener("click", renderLeaderboard);
ui.playAgain.addEventListener("click", () => {
  // The player only enters their name once. Replays start immediately
  // with the remembered name instead of returning to the name form.
  ui.endOverlay.classList.remove("visible");
  ui.startOverlay.classList.remove("visible");
  ui.submitMessage.textContent = "";
  setGameUiActive(true);
  startGameMusic();
  if (sceneRef) sceneRef.startRun();
});

ui.startButton.addEventListener("click", () => {
  const name = safeName();
  if (!name) {
    ui.startMessage.textContent = "Please enter a name first.";
    ui.playerName.focus();
    return;
  }
  playerName = name;
  rememberPlayerName(name);
  ui.startMessage.textContent = "";
  ui.endOverlay.classList.remove("visible");
  ui.startOverlay.classList.remove("visible");
  setGameUiActive(true);
  startGameMusic();
  if (sceneRef) sceneRef.startRun();
});

class WeddingScene extends Phaser.Scene {
  constructor() {
    super("WeddingScene");
    this.running = false;
  }

  preload() {
    this.load.image("player", "assets/player.png");
    this.load.image("playerSuper", "assets/playerSuper.png");
    this.load.image("bride", "assets/bride.png");
    this.load.image("cagedBride", "assets/cagedBride.png");
  }

  createTextures() {
    const make = (key, w, h, draw) => {
      const g = this.add.graphics();
      draw(g, w, h);
      g.generateTexture(key, w, h);
      g.destroy();
    };

    // Dedicated physics shape for the player. The visible character artwork
    // is rendered separately so its feet can stay aligned with platform tops.
    make("playerHitbox", 32, 56, (g) => {
      g.fillStyle(0xffffff, 0.01).fillRect(0, 0, 32, 56);
    });

    if (!this.textures.exists("player")) {
    make("player", 56, 68, (g) => {
      // Neater groom in a blue wedding suit with long sleeves.
      g.fillStyle(0xf2c79f).fillRoundedRect(18, 6, 20, 18, 5);
      g.fillStyle(0x5a382b).fillRoundedRect(16, 1, 24, 9, 4);
      g.fillStyle(0x22252c).fillCircle(25, 14, 1.2).fillCircle(31, 14, 1.2);
      g.lineStyle(1.2, 0x8a5e56, 1).beginPath().arc(28, 18, 3.4, 0.28, Math.PI - 0.28).strokePath();
      g.fillStyle(0x204b98).fillRoundedRect(16, 24, 24, 21, 4);
      g.fillStyle(0xffffff).fillTriangle(21, 27, 35, 27, 28, 38);
      g.fillStyle(0x9a1f29).fillTriangle(28, 27, 25, 39, 31, 39);
      g.fillStyle(0x163a79).fillTriangle(16, 24, 10, 40, 16, 40);
      g.fillTriangle(40, 24, 46, 40, 40, 40);
      g.fillStyle(0xf2c79f).fillCircle(10, 41, 3.2).fillCircle(46, 41, 3.2);
      g.fillStyle(0xf0c247).fillCircle(36, 30, 1.8).fillCircle(38, 32, 1.5);
      g.fillStyle(0x1e232e).fillRect(18, 45, 8, 14).fillRect(30, 45, 8, 14);
      g.fillStyle(0x11151c).fillRect(17, 58, 10, 4).fillRect(29, 58, 10, 4);
    });
    }

    if (!this.textures.exists("playerSuper")) {
    make("playerSuper", 64, 74, (g) => {
      // Neater superhero groom with full sleeves and cape.
      g.fillStyle(0xd34242).fillTriangle(23, 26, 8, 57, 24, 59);
      g.fillTriangle(39, 26, 56, 57, 40, 59);
      g.fillStyle(0xf2c79f).fillRoundedRect(22, 6, 20, 18, 5);
      g.fillStyle(0x5a382b).fillRoundedRect(20, 1, 24, 9, 4);
      g.fillStyle(0x22252c).fillCircle(29, 14, 1.2).fillCircle(35, 14, 1.2);
      g.lineStyle(1.2, 0x8a5e56, 1).beginPath().arc(32, 18, 3.4, 0.28, Math.PI - 0.28).strokePath();
      g.fillStyle(0x2b67c7).fillRoundedRect(20, 24, 24, 21, 4);
      g.fillStyle(0xf1c84b).fillRoundedRect(26, 28, 12, 10, 2);
      g.lineStyle(2.1, 0xc93737, 1).strokeRect(26, 28, 12, 10);
      g.lineStyle(1.7, 0xc93737, 1).beginPath().moveTo(36, 30).lineTo(29, 30).lineTo(28, 33).lineTo(35, 34).lineTo(34, 37).lineTo(28, 37).strokePath();
      g.fillStyle(0x2458ad).fillTriangle(20, 24, 14, 40, 20, 40).fillTriangle(44, 24, 50, 40, 44, 40);
      g.fillStyle(0xf2c79f).fillCircle(14, 41, 3.2).fillCircle(50, 41, 3.2);
      g.fillStyle(0xd34242).fillTriangle(32, 45, 26, 51, 38, 51);
      g.fillStyle(0x2b67c7).fillRect(22, 45, 8, 15).fillRect(34, 45, 8, 15);
      g.fillStyle(0xd34242).fillRect(21, 59, 10, 4).fillRect(33, 59, 10, 4);
    });
    }

    make("ground", 128, 48, (g) => {
      g.fillStyle(0x4f8a4f).fillRect(0, 0, 128, 10);
      g.fillStyle(0xb88b62).fillRect(0, 10, 128, 38);
      g.fillStyle(0xa97954).fillRect(0, 30, 128, 18);
    });

    make("platform", 112, 28, (g) => {
      g.fillStyle(0x719d58).fillRoundedRect(0, 0, 112, 12, 4);
      g.fillStyle(0xc7a27d).fillRoundedRect(0, 9, 112, 19, 4);
    });

    make("ring", 30, 30, (g) => {
      g.lineStyle(6, 0xe4b63f, 1).strokeCircle(15, 15, 9);
      g.lineStyle(2, 0xffe7a1, 1).strokeCircle(15, 15, 7);
    });

    make("heart", 34, 30, (g) => {
      g.fillStyle(0xb64f62);
      g.fillCircle(11, 10, 8);
      g.fillCircle(23, 10, 8);
      g.fillTriangle(4, 12, 30, 12, 17, 29);
    });

    make("cat", 64, 46, (g) => {
      // Cartoon cat used as the static ground hazard.
      g.fillStyle(0x5a5653).fillEllipse(31, 28, 38, 22); // body
      g.fillCircle(48, 20, 13); // head
      g.fillTriangle(39, 12, 42, 1, 49, 10); // ears
      g.fillTriangle(51, 9, 58, 1, 59, 14);
      g.fillStyle(0xd9b9a8).fillTriangle(42, 10, 43, 5, 47, 10);
      g.fillTriangle(53, 9, 57, 5, 58, 12);
      g.fillStyle(0xf3d85c).fillCircle(44, 19, 2.3);
      g.fillCircle(53, 19, 2.3);
      g.fillStyle(0x25272b).fillCircle(44, 19, 1.1);
      g.fillCircle(53, 19, 1.1);
      g.fillStyle(0xe5a8a0).fillTriangle(48, 23, 51, 23, 49.5, 26);
      g.lineStyle(1.4, 0x25272b, 1)
        .beginPath().moveTo(42, 25).lineTo(31, 23).moveTo(42, 27).lineTo(30, 28)
        .moveTo(56, 25).lineTo(64, 22).moveTo(56, 27).lineTo(64, 29).strokePath();
      g.fillStyle(0x5a5653).fillRoundedRect(18, 35, 8, 9, 3); // legs
      g.fillRoundedRect(39, 35, 8, 9, 3);
      g.lineStyle(5, 0x5a5653, 1).beginPath().moveTo(12, 27).lineTo(5, 22).lineTo(3, 14).lineTo(7, 7).strokePath(); // tail
      g.fillStyle(0xb64f62).fillRect(40, 29, 17, 3); // collar
      g.fillStyle(0xe4b63f).fillCircle(48, 33, 3); // bell
    });

    make("zombie", 54, 66, (g) => {
      // Original cartoon Frankenstein-style monster: green square head,
      // dark hair, neck bolts and stitches. Deliberately playful/non-gory.
      g.fillStyle(0x303238).fillRoundedRect(11, 2, 32, 12, 3);
      g.fillStyle(0x303238).fillTriangle(12, 12, 18, 7, 20, 15);
      g.fillTriangle(23, 13, 28, 6, 31, 15);
      g.fillTriangle(34, 13, 39, 7, 42, 15);
      g.fillStyle(0x78a85a).fillRoundedRect(10, 10, 34, 28, 6);
      g.fillStyle(0x8dbd6d).fillRect(6, 19, 6, 8);
      g.fillRect(42, 19, 6, 8);
      g.fillStyle(0xbfc4c8).fillRect(3, 20, 5, 6);
      g.fillRect(46, 20, 5, 6);
      g.fillStyle(0xf1f1dc).fillCircle(20, 21, 4);
      g.fillCircle(34, 21, 4);
      g.fillStyle(0x25272b).fillCircle(20, 21, 1.8);
      g.fillCircle(34, 21, 1.8);
      g.lineStyle(2, 0x38402f, 1).beginPath().moveTo(18, 31).lineTo(35, 31).strokePath();
      g.lineStyle(1.7, 0x38402f, 1).beginPath().moveTo(28, 12).lineTo(28, 18).moveTo(25, 15).lineTo(31, 15).strokePath();
      g.fillStyle(0x4c4064).fillRoundedRect(11, 38, 32, 18, 4);
      g.fillStyle(0x5d4c76).fillRect(5, 40, 9, 9);
      g.fillRect(40, 40, 9, 9);
      g.fillStyle(0x33363b).fillRect(11, 55, 13, 10);
      g.fillRect(31, 55, 13, 10);
    });

    make("seagull", 82, 42, (g) => {
      // Cartoon seagull for the upper sky lanes, carrying a sandwich.
      g.fillStyle(0xf7f7f4).fillEllipse(36, 23, 34, 19); // body
      g.fillStyle(0xffffff).fillCircle(52, 18, 11); // head
      g.fillStyle(0xe4b63f).fillTriangle(60, 18, 67, 21, 60, 24); // beak upper
      g.fillStyle(0xd79f37).fillTriangle(60, 20, 66, 22, 60, 25); // beak lower
      g.fillStyle(0x25272b).fillCircle(55, 16, 1.8); // eye
      g.fillStyle(0xc8c9cb).fillTriangle(29, 21, 5, 7, 23, 27); // upper wing
      g.fillTriangle(31, 24, 7, 37, 26, 28); // lower wing
      g.fillStyle(0x686b70).fillTriangle(20, 24, 8, 19, 12, 28); // tail
      // Sandwich held in the beak.
      g.fillStyle(0xd8aa63).fillRoundedRect(63, 17, 17, 10, 2); // bread bottom
      g.fillStyle(0x6faa56).fillRect(64, 19, 15, 2); // lettuce
      g.fillStyle(0xc76a53).fillRect(65, 21, 13, 2); // filling
      g.fillStyle(0xf1d195).fillRoundedRect(63, 14, 17, 6, 2); // bread top
      g.lineStyle(2, 0xe3a13b, 1).beginPath()
        .moveTo(39, 31).lineTo(37, 38)
        .moveTo(45, 31).lineTo(44, 38)
        .strokePath();
      g.lineStyle(2, 0xe3a13b, 1).beginPath()
        .moveTo(34, 38).lineTo(40, 38)
        .moveTo(41, 38).lineTo(47, 38)
        .strokePath();
    });

    make("flame", 130, 54, (g) => {
      // Elongated cartoon flamethrower plume, not circular.
      g.fillStyle(0x7d7f83).fillRoundedRect(0, 19, 20, 16, 5); // nozzle
      g.fillStyle(0xd94b35).fillTriangle(14, 27, 100, 4, 126, 27);
      g.fillTriangle(14, 27, 100, 50, 126, 27);
      g.fillStyle(0xf08a32).fillTriangle(14, 27, 86, 10, 108, 27);
      g.fillTriangle(14, 27, 86, 44, 108, 27);
      g.fillStyle(0xf7c845).fillTriangle(16, 27, 67, 14, 86, 27);
      g.fillTriangle(16, 27, 67, 40, 86, 27);
      g.fillStyle(0xffef9b).fillTriangle(19, 27, 49, 19, 65, 27);
      g.fillTriangle(19, 27, 49, 35, 65, 27);
      g.fillStyle(0xffffff).fillTriangle(20, 27, 36, 24, 47, 27);
      g.fillTriangle(20, 27, 36, 30, 47, 27);
      // small spiky tongues near the tip
      g.fillStyle(0xf7c845).fillTriangle(82, 18, 100, 12, 92, 26);
      g.fillTriangle(82, 36, 100, 42, 92, 28);
      g.fillStyle(0xffef9b).fillTriangle(95, 21, 114, 16, 108, 27);
      g.fillTriangle(95, 33, 114, 38, 108, 27);
    });

    make("superpower", 72, 68, (g) => {
      // Clean, symmetrical superhero-style diamond shield.
      const outer = [
        new Phaser.Geom.Point(7, 14),
        new Phaser.Geom.Point(18, 5),
        new Phaser.Geom.Point(54, 5),
        new Phaser.Geom.Point(65, 14),
        new Phaser.Geom.Point(58, 35),
        new Phaser.Geom.Point(36, 64),
        new Phaser.Geom.Point(14, 35)
      ];
      const inner = [
        new Phaser.Geom.Point(13, 16),
        new Phaser.Geom.Point(22, 10),
        new Phaser.Geom.Point(50, 10),
        new Phaser.Geom.Point(59, 16),
        new Phaser.Geom.Point(53, 32),
        new Phaser.Geom.Point(36, 56),
        new Phaser.Geom.Point(19, 32)
      ];

      // subtle dark outline, red border, gold face
      g.fillStyle(0x7f2028).fillPoints(outer, true);
      g.fillStyle(0xc9363f).fillPoints(inner, true);

      const face = [
        new Phaser.Geom.Point(18, 18),
        new Phaser.Geom.Point(25, 13),
        new Phaser.Geom.Point(47, 13),
        new Phaser.Geom.Point(54, 18),
        new Phaser.Geom.Point(49, 30),
        new Phaser.Geom.Point(36, 49),
        new Phaser.Geom.Point(23, 30)
      ];
      g.fillStyle(0xf5ca45).fillPoints(face, true);

      // centred stylised S with balanced top and bottom curves
      g.lineStyle(7, 0xb62f38, 1).beginPath()
        .moveTo(47, 21)
        .lineTo(31, 21)
        .lineTo(25, 26)
        .lineTo(29, 31)
        .lineTo(43, 34)
        .lineTo(47, 39)
        .lineTo(41, 45)
        .lineTo(25, 45)
        .strokePath();
      g.lineStyle(2, 0xfff1a8, 0.9).beginPath()
        .moveTo(23, 17).lineTo(49, 17).strokePath();
    });

    make("laser", 100, 12, (g) => {
      g.fillStyle(0xef3f3f).fillRoundedRect(0, 0, 100, 12, 6);
      g.fillStyle(0xffffff).fillRoundedRect(7, 4, 86, 4, 2);
    });

    make("fuel", 40, 48, (g) => {
      g.fillStyle(0xd94b35).fillRoundedRect(8, 10, 22, 28, 4);
      g.fillStyle(0x7d7f83).fillRect(22, 4, 8, 10);
      g.fillStyle(0xfff4d8).fillRect(14, 20, 10, 4);
      g.fillStyle(0xf7c845).fillTriangle(19, 17, 27, 27, 11, 27);
    });

    make("key", 44, 24, (g) => {
      g.lineStyle(6, 0xe4b63f, 1).strokeCircle(10, 12, 7);
      g.fillStyle(0xe4b63f).fillRect(16, 9, 18, 6);
      g.fillRect(28, 9, 4, 11);
      g.fillRect(34, 9, 4, 8);
    });

    if (!this.textures.exists("bride")) {
    make("bride", 56, 68, (g) => {
      // Neater bride with a clearer wedding dress and veil.
      g.fillStyle(0xffffff, 0.45).fillRoundedRect(14, 5, 28, 10, 5);
      g.fillStyle(0xffffff, 0.3).fillTriangle(18, 12, 38, 12, 46, 33);
      g.fillStyle(0xf2c79f).fillRoundedRect(18, 6, 20, 18, 5);
      g.fillStyle(0x5a382b).fillRoundedRect(16, 1, 24, 10, 4);
      g.fillStyle(0x22252c).fillCircle(25, 14, 1.2).fillCircle(31, 14, 1.2);
      g.lineStyle(1.2, 0x8a5e56, 1).beginPath().arc(28, 18, 3.4, 0.28, Math.PI - 0.28).strokePath();
      g.fillStyle(0xffffff).fillRoundedRect(18, 24, 20, 14, 4);
      g.fillStyle(0xf7f2ec).fillTriangle(28, 34, 10, 58, 46, 58);
      g.fillStyle(0xffffff).fillTriangle(28, 37, 15, 60, 41, 60);
      g.fillStyle(0xffffff).fillRect(20, 38, 6, 18).fillRect(30, 38, 6, 18);
      g.fillStyle(0xf2c79f).fillRect(13, 28, 5, 11).fillRect(38, 28, 5, 11);
      g.fillStyle(0xf2c79f).fillCircle(14, 40, 3).fillCircle(42, 40, 3);
      g.fillStyle(0x6f9b63).fillCircle(38, 34, 5);
      g.fillStyle(0xb64f62).fillCircle(35, 32, 2.9);
      g.fillStyle(0xe4b63f).fillCircle(41, 32, 2.1);
      g.fillStyle(0xece5de).fillRect(18, 58, 10, 3).fillRect(28, 58, 10, 3);
    });
    }

    if (!this.textures.exists("cagedBride")) {
    make("cagedBride", 100, 110, (g) => {
      // Cage with neater bride inside, including dress and bouquet.
      g.fillStyle(0x6f7378).fillRoundedRect(10, 8, 80, 94, 6);
      g.fillStyle(0x52565b).fillRect(16, 14, 68, 8);
      [24, 36, 48, 60, 72].forEach((x) => g.fillRect(x, 22, 6, 64));
      g.fillStyle(0xbfc4c8).fillCircle(80, 55, 5);
      g.fillStyle(0xffffff, 0.38).fillRoundedRect(38, 25, 24, 8, 4);
      g.fillStyle(0xffffff, 0.24).fillTriangle(41, 32, 59, 32, 67, 54);
      g.fillStyle(0xf2c79f).fillRoundedRect(41, 28, 18, 16, 4);
      g.fillStyle(0x5a382b).fillRoundedRect(39, 23, 22, 9, 4);
      g.fillStyle(0x22252c).fillCircle(47, 36, 1).fillCircle(53, 36, 1);
      g.lineStyle(1.1, 0x8a5e56, 1).beginPath().arc(50, 39, 2.9, 0.28, Math.PI - 0.28).strokePath();
      g.fillStyle(0xffffff).fillRoundedRect(42, 46, 16, 12, 4);
      g.fillStyle(0xf7f2ec).fillTriangle(50, 55, 35, 80, 65, 80);
      g.fillStyle(0xffffff).fillTriangle(50, 58, 39, 80, 61, 80);
      g.fillStyle(0xf2c79f).fillRect(37, 49, 4, 9).fillRect(59, 49, 4, 9);
      g.fillStyle(0xf2c79f).fillCircle(38, 58, 3).fillCircle(62, 58, 3);
      g.fillStyle(0x6f9b63).fillCircle(58, 52, 4);
      g.fillStyle(0xb64f62).fillCircle(55, 50, 2.5);
      g.fillStyle(0xe4b63f).fillCircle(61, 50, 1.8);
      g.fillStyle(0xece5de).fillRect(42, 80, 7, 3).fillRect(51, 80, 7, 3);
      g.lineStyle(3, 0x6f7378, 1).beginPath().moveTo(80, 50).lineTo(84, 50).lineTo(84, 60).lineTo(80, 60).strokePath();
    });
    }
  }

  create() {
    sceneRef = this;
    this.createTextures();
    this.cameras.main.setBackgroundColor("#cfeafd");
    this.physics.world.setBounds(0, 0, 11350, 720);
    this.cameras.main.setBounds(0, 0, 11350, 720);

    // Soft cloud scenery instead of the old blocky/square background shapes.
    for (let i = 0; i < 34; i++) {
      const x = i * 320 + 70;
      const y = 125 + (i % 4) * 55;
      const cloud = this.add.container(x, y).setDepth(-5);
      cloud.add([
        this.add.ellipse(-42, 8, 78, 34, 0xffffff, 0.82),
        this.add.ellipse(0, 0, 92, 46, 0xffffff, 0.9),
        this.add.ellipse(43, 10, 72, 32, 0xffffff, 0.82),
        this.add.ellipse(4, 16, 150, 34, 0xffffff, 0.78)
      ]);
    }
    this.add.circle(900, 120, 58, 0xffefb0, 0.9).setDepth(-6);

    this.platforms = this.physics.add.staticGroup();

    // Build the floor in exact 128 px tiles. The previous prototype used
    // approximate segment widths, which meant the texture tiling sometimes
    // overran a segment and left accidental tiny gaps (one was only 4 px).
    // These five gaps are now deliberately and consistently 140 px wide.
    const addGroundTiles = (x, tileCount) => {
      for (let i = 0; i < tileCount; i++) {
        this.platforms.create(x + (i * 128) + 64, 680, "ground").refreshBody();
      }
    };

    addGroundTiles(0, 9);       // 0–1152
    addGroundTiles(1292, 6);    // 1292–2060
    addGroundTiles(2200, 7);    // 2200–3096
    addGroundTiles(3236, 6);    // 3236–4004
    addGroundTiles(4144, 7);    // 4144–5040
    addGroundTiles(5180, 11);   // 5180–6588
    addGroundTiles(6728, 8);    // 6728–7752
    addGroundTiles(7892, 8);    // 7892–8916
    addGroundTiles(9056, 8);    // 9056–10080
    addGroundTiles(10220, 8);   // 10220–11244

    [
      [520, 560], [760, 500], [1030, 445], [1460, 525], [1680, 455], [1910, 390],
      [2350, 520], [2580, 455], [2820, 390], [3400, 510], [3630, 445], [3880, 385],
      [4320, 525], [4550, 465], [4770, 405], [5330, 520], [5580, 450], [5840, 385],
      [6080, 320], [6310, 390], [6900, 520], [7140, 455], [7420, 390], [8050, 520],
      [8320, 445], [8610, 370], [9230, 520], [9500, 455], [9780, 385], [10420, 510],
      [10680, 435]
    ].forEach(([x, y]) => this.platforms.create(x, y, "platform").refreshBody());

    this.rings = this.physics.add.group({ allowGravity: false, immovable: true });
    for (let x = 260; x < 11050; x += 230) {
      const y = 535 - ((Math.floor(x / 230) % 3) * 58);
      this.rings.create(x, y, "ring");
    }

    this.hearts = this.physics.add.group({ allowGravity: false, immovable: true });
    [[850,450],[1760,360],[2670,415],[3710,405],[4650,425],[5620,420],[6280,350],[7240,410],[8400,400],[9560,415],[10650,395]].forEach(([x,y]) => this.hearts.create(x,y,"heart"));

    this.fuelPickups = this.physics.add.group({ allowGravity: false, immovable: true });
    [[3320, 350]].forEach(([x, y]) => this.fuelPickups.create(x, y, "fuel"));

    this.superPower = this.physics.add.staticImage(8610, 285, "superpower");
    this.superPower.setDepth(8);
    this.keyItem = this.physics.add.staticImage(10680, 365, "key");
    this.keyItem.setDepth(8);

    this.cats = this.physics.add.staticGroup();
    [[960,640],[1560,640],[2470,640],[3490,640],[4420,640],[5400,640],[6020,640],[7040,640],[8220,640],[9360,640],[10320,640]].forEach(([x,y]) => {
      const cat = this.cats.create(x, y, "cat");
      cat.body.setSize(50, 30).setOffset(7, 14);
      cat.refreshBody();
    });

    // Moving cartoon zombies. Each patrols a short stretch of safe ground.
    this.zombies = this.physics.add.group({ allowGravity: true });
    [
      [650, 560, 150],
      [1500, 560, 145],
      [2400, 560, 155],
      [3450, 560, 150],
      [4480, 560, 150],
      [5460, 560, 140],
      [6200, 560, 150],
      [7000, 560, 145],
      [8150, 560, 150],
      [9300, 560, 150],
      [10400, 560, 150]
    ].forEach(([x, y, range], index) => {
      const zombie = this.zombies.create(x, y, "zombie");
      zombie.body.setSize(34, 58).setOffset(7, 4);
      zombie.setCollideWorldBounds(false);
      zombie.setData("homeX", x);
      zombie.setData("range", range);
      zombie.setData("direction", index % 2 === 0 ? 1 : -1);
      zombie.setVelocityX((index % 2 === 0 ? 1 : -1) * 72);
    });

    // Airborne seagulls patrol the upper lanes and higher platforms.
    this.seagulls = this.physics.add.group({ allowGravity: false, immovable: true });
    [
      [1120, 330, 180, 74, 18],
      [2050, 285, 210, 82, 24],
      [3180, 345, 190, 78, 20],
      [4380, 300, 220, 86, 26],
      [5850, 250, 190, 82, 18],
      [6900, 325, 230, 90, 24],
      [8030, 270, 200, 88, 20],
      [9180, 315, 220, 94, 26],
      [10100, 255, 205, 92, 22]
    ].forEach(([x, y, range, speed, bob], index) => {
      const gull = this.seagulls.create(x, y, "seagull");
      gull.body.setSize(48, 26).setOffset(10, 8);
      gull.setCollideWorldBounds(false);
      gull.setData("homeX", x);
      gull.setData("homeY", y);
      gull.setData("range", range);
      gull.setData("speed", speed);
      gull.setData("bob", bob);
      gull.setData("phase", index * 0.85);
      gull.setData("direction", index % 2 === 0 ? 1 : -1);
      gull.setVelocityX((index % 2 === 0 ? 1 : -1) * speed);
      gull.setDepth(7);
    });

    this.flames = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.overlap(this.flames, this.zombies, (flame, zombie) => this.burnZombie(flame, zombie));
    this.physics.add.overlap(this.flames, this.cats, (flame, cat) => this.burnCat(flame, cat));
    this.physics.add.overlap(this.flames, this.seagulls, (flame, gull) => this.burnSeagull(flame, gull));

    this.lasers = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.overlap(this.lasers, this.zombies, (laser, zombie) => this.laserZombie(laser, zombie));
    this.physics.add.overlap(this.lasers, this.seagulls, (laser, gull) => this.laserSeagull(laser, gull));

    this.finish = this.physics.add.staticImage(11050, 624, "cagedBride");
    this.finish.setDisplaySize(94, 108);
    this.finish.refreshBody();

    // Visible level markers make the continuous browser world feel like four distinct stages.
    [[2800, "LEVEL 2"], [5600, "LEVEL 3"], [8400, "LEVEL 4 — RESCUE"]].forEach(([x, label]) => {
      this.add.text(x, 105, label, {
        fontFamily: "Arial, sans-serif", fontSize: "28px", fontStyle: "bold",
        color: "#453342", backgroundColor: "#fffaf4", padding: { x: 14, y: 8 }
      }).setOrigin(0.5).setDepth(4);
    });

    this.player = this.physics.add.sprite(120, 628, "playerHitbox").setCollideWorldBounds(false);
    this.player.setVisible(false);
    this.player.body.setSize(32, 56).setOffset(0, 0);

    this.playerVisual = this.add.image(120, 656, "player");
    this.playerVisual.setDisplaySize(62, 68);
    this.playerVisual.setOrigin(0.5, 1);
    this.playerVisual.setDepth(12);

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.rings, (_, item) => this.collectRing(item));
    this.physics.add.overlap(this.player, this.hearts, (_, item) => this.collectHeart(item));
    this.physics.add.overlap(this.player, this.fuelPickups, (_, item) => this.collectFuel(item));
    this.physics.add.overlap(this.player, this.superPower, () => this.collectSuperPower());
    this.physics.add.overlap(this.player, this.keyItem, () => this.collectKey());
    this.physics.add.collider(this.player, this.cats, (player, cat) => this.hitCat(player, cat));
    this.physics.add.collider(this.zombies, this.platforms);
    this.physics.add.collider(this.player, this.zombies, (player, zombie) => this.hitZombie(player, zombie));
    this.physics.add.overlap(this.player, this.seagulls, (player, gull) => this.hitSeagull(player, gull));
    this.physics.add.overlap(this.player, this.finish, () => this.tryFinish());

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyF = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.keyF.on("down", () => this.fireFlamethrower());

    this.cameras.main.startFollow(this.player, true, 0.12, 0.12, -150, 30);

    this.checkpoints = [120, 1320, 2240, 2860, 4180, 5200, 5680, 6900, 8000, 8480, 9300, 10280];
    this.checkpointX = 120;
    this.levelThresholds = [0, 2800, 5600, 8400];
    this.resetRunState();
  }

  syncPlayerVisual() {
    if (!this.player || !this.playerVisual || !this.player.body) return;
    // Keep the high-resolution artwork locked to gameplay scale. This is
    // especially important when switching to the superhero texture.
    if (this.superActive) {
      if (this.playerVisual.texture.key !== "playerSuper") this.playerVisual.setTexture("playerSuper");
      this.playerVisual.setDisplaySize(66, 72);
    } else {
      if (this.playerVisual.texture.key !== "player") this.playerVisual.setTexture("player");
      this.playerVisual.setDisplaySize(62, 68);
    }
    this.playerVisual.setOrigin(0.5, 1);
    this.playerVisual.setPosition(this.player.x, this.player.body.bottom);
    this.playerVisual.setFlipX(this.facing < 0);
  }

  resetRunState() {
    this.running = false;
    this.score = 0;
    this.ringsCollected = 0;
    this.heartsCollected = 0;
    this.heartShields = 0;
    this.flameCharges = 1;
    this.hasKey = false;
    this.rescueInProgress = false;
    this.nextNeedKeyMessageAt = 0;
    this.superCheat = playerName === "LoA";
    this.superActive = false;
    this.superUntil = 0;
    this.facing = 1;
    this.invulnerable = false;
    this.penalties = 0;
    this.startTime = 0;
    this.checkpointX = 120;
    this.currentLevel = 1;
    ui.hudLevel.textContent = "1/4";
    ui.hudScore.textContent = "0";
    ui.hudRings.textContent = "0";
    ui.hudHearts.textContent = "0";
    ui.hudFire.textContent = "1";
    ui.hudSuper.textContent = "—";
    ui.fire.textContent = "🔥 FIRE";
    ui.fire.setAttribute("aria-label", "Fire flamethrower; one use at a time");
    ui.hudTime.textContent = "0.0";
  }

  resetObjects() {
    this.rings.children.iterate((child) => child && child.enableBody(false, child.x, child.y, true, true));
    this.hearts.children.iterate((child) => child && child.enableBody(false, child.x, child.y, true, true));
    this.fuelPickups.children.iterate((child) => child && child.enableBody(false, child.x, child.y, true, true));
    this.zombies.children.iterate((zombie) => {
      if (!zombie) return;
      const homeX = zombie.getData("homeX");
      const direction = zombie.getData("direction") || 1;
      zombie.enableBody(true, homeX, 560, true, true);
      zombie.setVelocity(direction * 72, 0);
      zombie.setAlpha(1);
      zombie.clearTint();
    });
    this.seagulls.children.iterate((gull) => {
      if (!gull) return;
      const homeX = gull.getData("homeX");
      const homeY = gull.getData("homeY");
      const direction = gull.getData("direction") || 1;
      const speed = gull.getData("speed") || 82;
      gull.enableBody(true, homeX, homeY, true, true);
      gull.setVelocity(direction * speed, 0);
      gull.setAlpha(1);
      gull.clearTint();
    });
    if (this.flames) this.flames.clear(true, true);
    if (this.lasers) this.lasers.clear(true, true);
    if (this.superPower) {
      this.superPower.enableBody(false, 8610, 285, true, true);
      this.superPower.setAlpha(1);
    }
    if (this.keyItem) {
      this.keyItem.enableBody(false, 10680, 365, true, true);
      this.keyItem.setAlpha(1);
    }
    if (this.finish) {
      this.finish.enableBody(false, 11050, 624, true, true);
      this.finish.setDisplaySize(94, 108);
      this.finish.refreshBody();
      this.finish.setVisible(true);
      this.finish.setAlpha(1);
    }
    this.activeFlame = null;
  }

  startRun() {
    this.resetObjects();
    this.resetRunState();
    this.jumpsUsed = 0;
    this.wasJumping = false;
    this.running = true;
    this.startTime = performance.now();
    this.player.enableBody(true, 120, 628, true, true);
    this.player.setVisible(false);
    this.player.body.allowGravity = true;
    this.player.body.setSize(32, 56).setOffset(0, 0);
    this.player.setVelocity(0, 0);
    this.playerVisual.setTexture("player");
    this.playerVisual.setDisplaySize(62, 68);
    this.playerVisual.setVisible(true);
    this.playerVisual.setAlpha(1);

    if (this.superCheat) {
      this.superActive = true;
      this.superUntil = Number.POSITIVE_INFINITY;
      this.player.body.allowGravity = false;
      this.playerVisual.setTexture("playerSuper");
      this.playerVisual.setDisplaySize(66, 72);
      ui.fire.textContent = "⚡ LASER";
      ui.fire.setAttribute("aria-label", "Fire unlimited laser beams");
      if (this.superPower && this.superPower.active) this.superPower.disableBody(true, true);
    }

    this.syncPlayerVisual();
    this.updateHud();
    this.cameras.main.scrollX = 0;
    this.showLevelBanner(1);
  }

  elapsed() {
    return this.running ? (performance.now() - this.startTime) / 1000 : 0;
  }

  collectRing(item) {
    if (!this.running || !item.active) return;
    item.disableBody(true, true);
    this.ringsCollected++;
    this.score += 100;
    this.updateHud();
  }

  collectHeart(item) {
    if (!this.running || !item.active) return;
    item.disableBody(true, true);
    this.heartsCollected++;
    this.heartShields++;
    this.score += 300;
    this.showGameMessage("❤️ +1 LOVE SHIELD", item.x, item.y - 22);
    this.updateHud();
  }

  collectFuel(item) {
    if (!this.running || !item.active) return;
    item.disableBody(true, true);
    const before = this.flameCharges;
    this.flameCharges = Math.min(1, this.flameCharges + 1);
    this.score += 150;
    this.showGameMessage(before < 3 ? "⛽ +1 FLAME" : "⛽ FUEL FULL", item.x, item.y - 22);
    this.updateHud();
  }

  collectKey() {
    if (!this.running || !this.keyItem || !this.keyItem.active) return;
    this.keyItem.disableBody(true, true);
    this.hasKey = true;
    this.score += 250;
    this.showGameMessage("🔑 GOT THE KEY!", this.player.x, Math.max(80, this.player.y - 70));
    this.updateHud();
  }

  collectSuperPower() {
    if (this.superCheat) return;
    if (!this.running || !this.superPower || !this.superPower.active) return;
    this.superPower.disableBody(true, true);
    this.superActive = true;
    this.superUntil = performance.now() + 10000;
    this.player.body.allowGravity = false;
    this.player.setVelocityY(-160);
    this.player.setVisible(false);
    if (this.playerVisual) {
      this.playerVisual.setTexture("playerSuper");
      this.playerVisual.setDisplaySize(66, 72);
      this.playerVisual.setOrigin(0.5, 1);
      this.syncPlayerVisual();
    }
    ui.fire.textContent = "⚡ LASER";
    ui.fire.setAttribute("aria-label", "Fire unlimited laser beams while superhero power is active");
    this.score += 750;
    this.showGameMessage("🦸 SUPER POWER — 10 SECONDS!", this.player.x, Math.max(80, this.player.y - 70));
    this.updateHud();
  }

  tryFinish() {
    if (!this.running || this.rescueInProgress) return;
    if (!this.hasKey) {
      const now = performance.now();
      if (now >= this.nextNeedKeyMessageAt) {
        this.nextNeedKeyMessageAt = now + 1000;
        this.showGameMessage("🔑 NEED THE KEY!", this.finish.x, this.finish.y - 78);
      }
      return;
    }
    this.completeRun();
  }

  endSuperPower() {
    if (this.superCheat) return;
    if (!this.superActive) return;
    this.superActive = false;
    this.superUntil = 0;
    if (this.player && this.player.body) {
      this.player.body.allowGravity = true;
      this.player.setVisible(false);
    }
    if (this.playerVisual) {
      this.playerVisual.setTexture("player");
      this.playerVisual.setDisplaySize(62, 68);
    }
    ui.fire.textContent = "🔥 FIRE";
    ui.fire.setAttribute("aria-label", "Fire flamethrower; one use at a time");
    this.showGameMessage("SUPER POWER ENDED", this.player.x, Math.max(80, this.player.y - 70));
    this.updateHud();
  }

  showGameMessage(message, x = this.player.x, y = this.player.y - 60) {
    const label = this.add.text(x, y, message, {
      fontFamily: "Arial, sans-serif",
      fontSize: "20px",
      fontStyle: "bold",
      color: "#7a2d48",
      backgroundColor: "#fffaf4",
      padding: { x: 8, y: 5 }
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: label, y: y - 35, alpha: 0, duration: 1100, ease: "Cubic.Out", onComplete: () => label.destroy() });
  }

  useHeartShield(reason = "obstacle") {
    if (this.heartShields <= 0) return false;
    this.heartShields--;
    this.showGameMessage(reason === "fall" ? "❤️ LOVE SHIELD SAVED YOU!" : "❤️ LOVE SHIELD!", this.player.x, Math.max(80, this.player.y - 60));
    this.updateHud();
    return true;
  }

  defeatEnemyWhileSuper(enemy, label = "ENEMY") {
    if (!this.superActive || !enemy || !enemy.active) return false;
    const x = enemy.x;
    const y = enemy.y;
    enemy.disableBody(true, true);
    this.score += 500;
    this.showGameMessage(`⚡ SUPER ${label} +500`, x, y - 34);
    this.updateHud();
    return true;
  }

  hitCat(player, cat) {
    if (!this.running || !cat.active) return;
    if (this.superActive) {
      this.defeatEnemyWhileSuper(cat, "CAT");
      return;
    }
    if (this.invulnerable) return;

    // Landing on a cat defeats it, just like the other enemies.
    const playerBottom = player.body.bottom;
    const catTop = cat.body.top;
    const stomp = player.body.velocity.y > 80 && playerBottom <= catTop + 18;
    if (stomp) {
      cat.disableBody(true, true);
      player.setVelocityY(-350);
      this.score += 500;
      this.showGameMessage("CAT +500", cat.x, cat.y - 38);
      this.updateHud();
      return;
    }

    if (this.useHeartShield("obstacle")) {
      this.invulnerable = true;
      const push = player.x < cat.x ? -230 : 230;
      player.setVelocity(push, -330);
      if (this.playerVisual) this.playerVisual.setAlpha(0.55);
      this.showGameMessage("MEOW!", cat.x, cat.y - 48);
      this.time.delayedCall(900, () => {
        this.invulnerable = false;
        if (this.playerVisual) this.playerVisual.setAlpha(1);
      });
      return;
    }

    this.gameOver("The cat got you!");
  }

  positionActiveFlame() {
    if (!this.activeFlame || !this.activeFlame.active || !this.player) return;
    const direction = this.facing || 1;
    this.activeFlame.setFlipX(direction < 0);
    this.activeFlame.setPosition(this.player.x + direction * 70, this.player.y + 2);
  }

  fireFlamethrower() {
    if (!this.running || !this.player || !this.player.body || !this.player.body.enable) return;
    if (this.superActive) {
      this.fireLaser();
      return;
    }
    if (this.activeFlame && this.activeFlame.active) {
      this.showGameMessage("🔥 ALREADY FIRING", this.player.x, Math.max(70, this.player.y - 60));
      return;
    }
    if (this.flameCharges <= 0) {
      this.showGameMessage("🔥 OUT OF FUEL", this.player.x, Math.max(70, this.player.y - 60));
      return;
    }

    this.flameCharges--;
    const flame = this.flames.create(this.player.x, this.player.y + 2, "flame");
    flame.body.setSize(120, 42).setOffset(6, 6);
    flame.setImmovable(true);
    flame.body.moves = false;
    flame.setDepth(12);
    this.activeFlame = flame;
    this.positionActiveFlame();
    this.showGameMessage(`🔥 ${this.flameCharges} LEFT`, this.player.x, Math.max(70, this.player.y - 65));
    this.updateHud();

    this.time.delayedCall(2000, () => {
      if (this.activeFlame && this.activeFlame.active) this.activeFlame.destroy();
      this.activeFlame = null;
    });
  }

  burnZombie(flame, zombie) {
    if (!this.running || !flame.active || !zombie.active) return;
    const x = zombie.x;
    const y = zombie.y;
    zombie.disableBody(true, true);
    this.score += 500;
    this.showGameMessage("🔥 MONSTER +500", x, y - 36);
    this.updateHud();
  }

  burnCat(flame, cat) {
    if (!this.running || !flame.active || !cat.active) return;
    const x = cat.x;
    const y = cat.y;
    cat.disableBody(true, true);
    this.score += 500;
    this.showGameMessage("🔥 CAT +500", x, y - 34);
    this.updateHud();
  }

  burnSeagull(flame, gull) {
    if (!this.running || !flame.active || !gull.active) return;
    const x = gull.x;
    const y = gull.y;
    gull.disableBody(true, true);
    this.score += 500;
    this.showGameMessage("🔥 SEAGULL +500", x, y - 30);
    this.updateHud();
  }

  fireLaser() {
    if (!this.superActive || !this.running) return;
    const direction = this.facing || 1;
    const laser = this.lasers.create(this.player.x + direction * 60, this.player.y - 8, "laser");
    laser.body.setSize(92, 10).setOffset(4, 1);
    laser.setFlipX(direction < 0);
    laser.setVelocityX(direction * 1050);
    laser.setData("spent", false);
    laser.setDepth(14);
    this.time.delayedCall(420, () => {
      if (laser && laser.active) laser.destroy();
    });
  }

  laserZombie(laser, zombie) {
    if (!this.running || !laser.active || !zombie.active || laser.getData("spent")) return;
    laser.setData("spent", true);
    const x = zombie.x;
    const y = zombie.y;
    zombie.disableBody(true, true);
    laser.destroy();
    this.score += 500;
    this.showGameMessage("⚡ LASER +500", x, y - 36);
    this.updateHud();
  }

  laserSeagull(laser, gull) {
    if (!this.running || !laser.active || !gull.active || laser.getData("spent")) return;
    laser.setData("spent", true);
    const x = gull.x;
    const y = gull.y;
    gull.disableBody(true, true);
    laser.destroy();
    this.score += 500;
    this.showGameMessage("⚡ SEAGULL +500", x, y - 30);
    this.updateHud();
  }

  hitSeagull(player, gull) {
    if (!this.running || !gull.active) return;
    if (this.superActive) {
      this.defeatEnemyWhileSuper(gull, "SEAGULL");
      return;
    }
    if (this.invulnerable) return;

    // A clean stomp from above can also defeat a seagull.
    const stomp = player.body.velocity.y > 80 && player.body.bottom <= gull.body.top + 16;
    if (stomp) {
      gull.disableBody(true, true);
      player.setVelocityY(-330);
      this.score += 500;
      this.showGameMessage("SEAGULL +500", gull.x, gull.y - 28);
      this.updateHud();
      return;
    }

    if (this.useHeartShield("obstacle")) {
      this.invulnerable = true;
      const push = player.x < gull.x ? -230 : 230;
      player.setVelocity(push, 180);
      if (this.playerVisual) this.playerVisual.setAlpha(0.55);
      this.time.delayedCall(900, () => {
        this.invulnerable = false;
        if (this.playerVisual) this.playerVisual.setAlpha(1);
      });
      return;
    }

    this.gameOver("A seagull got you!");
  }

  hitZombie(player, zombie) {
    if (!this.running || !zombie.active) return;
    if (this.superActive) {
      this.defeatEnemyWhileSuper(zombie, "ZOMBIE");
      return;
    }
    if (this.invulnerable) return;

    // Landing on a zombie defeats it and gives a small bonus.
    const playerBottom = player.body.bottom;
    const zombieTop = zombie.body.top;
    const stomp = player.body.velocity.y > 80 && playerBottom <= zombieTop + 18;
    if (stomp) {
      zombie.disableBody(true, true);
      player.setVelocityY(-360);
      this.score += 500;
      this.showGameMessage("MONSTER +500", zombie.x, zombie.y - 35);
      this.updateHud();
      return;
    }

    if (this.useHeartShield("obstacle")) {
      this.invulnerable = true;
      const push = player.x < zombie.x ? -260 : 260;
      player.setVelocity(push, -320);
      if (this.playerVisual) this.playerVisual.setAlpha(0.55);
      this.time.delayedCall(900, () => {
        this.invulnerable = false;
        if (this.playerVisual) this.playerVisual.setAlpha(1);
      });
      return;
    }

    this.gameOver("A zombie got you!");
  }

  respawn() {
    this.player.setVelocity(0, 0);
    this.invulnerable = false;
    this.jumpsUsed = 0;
    this.wasJumping = false;
    this.player.setPosition(this.checkpointX, 628);
    if (this.playerVisual) this.playerVisual.setAlpha(0.55);
    this.syncPlayerVisual();
    this.time.delayedCall(500, () => {
      if (this.playerVisual) this.playerVisual.setAlpha(1);
    });
    this.updateHud();
  }

  showLevelBanner(level) {
    const titles = {
      1: "LEVEL 1",
      2: "LEVEL 2",
      3: "LEVEL 3",
      4: "LEVEL 4 — RESCUE THE BRIDE"
    };
    const label = this.add.text(this.player.x, 120, titles[level] || `LEVEL ${level}`, {
      fontFamily: "Arial, sans-serif",
      fontSize: level === 4 ? "28px" : "34px",
      fontStyle: "bold",
      color: "#7a2d48",
      backgroundColor: "#fffaf4",
      padding: { x: 18, y: 10 }
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: label, y: 92, alpha: 0, duration: 1800, delay: 650, ease: "Cubic.Out", onComplete: () => label.destroy() });
  }

  updateLevelProgress() {
    let level = 1;
    if (this.player.x >= 8400) level = 4;
    else if (this.player.x >= 5600) level = 3;
    else if (this.player.x >= 2800) level = 2;

    if (level !== this.currentLevel) {
      this.currentLevel = level;
      this.score += 500;
      this.showLevelBanner(level);
      this.showGameMessage(`LEVEL ${level} +500`, this.player.x, Math.max(150, this.player.y - 95));
    }
    ui.hudLevel.textContent = `${this.currentLevel}/4`;
  }

  updateCheckpoint() {
    for (const cp of this.checkpoints) {
      if (this.player.x >= cp) this.checkpointX = cp;
    }
  }

  updateHud() {
    ui.hudScore.textContent = Math.max(0, Math.round(this.score)).toLocaleString();
    ui.hudRings.textContent = this.ringsCollected;
    ui.hudHearts.textContent = this.heartShields;
    ui.hudFire.textContent = this.flameCharges;
    const superSeconds = this.superActive && !this.superCheat
      ? Math.max(0, Math.ceil((this.superUntil - performance.now()) / 1000))
      : 0;
    ui.hudSuper.textContent = this.superCheat && this.superActive
      ? "∞"
      : (this.superActive ? `${superSeconds}s` : "—");
    ui.hudTime.textContent = this.elapsed().toFixed(1);
  }

  gameOver(reason) {
    if (!this.running) return;
    stopGameMusic();
    this.running = false;
    this.superActive = false;
    this.superUntil = 0;
    ui.fire.textContent = "🔥 FIRE";
    this.player.setVelocity(0, 0);
    if (this.activeFlame && this.activeFlame.active) this.activeFlame.destroy();
    this.activeFlame = null;
    this.player.body.allowGravity = true;
    if (this.playerVisual) {
      this.playerVisual.setTexture("player");
      this.playerVisual.setDisplaySize(62, 68);
      this.playerVisual.setAlpha(1);
      this.syncPlayerVisual();
    }
    this.player.body.enable = false;

    ui.endBadge.textContent = "🧟 GAME OVER";
    ui.endTitle.textContent = reason;
    ui.scoreBreakdown.innerHTML = `
      <div class="score-row"><span>Rings collected</span><strong>${this.ringsCollected}</strong></div>
      <div class="score-row"><span>Hearts collected</span><strong>${this.heartsCollected}</strong></div>
      <div class="score-row"><span>Score reached</span><strong>${Math.max(0, Math.round(this.score)).toLocaleString()}</strong></div>
      <div class="score-row score-total"><span>Result</span><strong>Try again</strong></div>
    `;
    ui.submitMessage.textContent = "Game-over attempts are not added to the leaderboard.";
    setGameUiActive(false);
    ui.endOverlay.classList.add("visible");
  }

  async completeRun() {
    if (!this.running || this.rescueInProgress) return;
    stopGameMusic();
    this.rescueInProgress = true;

    // Capture completion time before freezing gameplay so the celebration
    // animation does not affect the player's time bonus.
    const timeSeconds = Math.min(this.elapsed(), MAX_LEVEL_SECONDS);

    // Freeze gameplay first, but keep the game canvas visible for the rescue scene.
    this.running = false;
    this.superActive = false;
    this.superUntil = 0;
    ui.fire.textContent = "🔥 FIRE";
    this.player.setVelocity(0, 0);
    if (this.activeFlame && this.activeFlame.active) this.activeFlame.destroy();
    this.activeFlame = null;
    this.player.body.allowGravity = true;
    this.player.body.enable = false;

    if (this.playerVisual) {
      this.playerVisual.setTexture("player");
      this.playerVisual.setDisplaySize(62, 68);
      this.playerVisual.setAlpha(1);
      this.playerVisual.setFlipX(false);
      this.syncPlayerVisual();
    }

    // Open the cage and place the bride beside the groom.
    if (this.finish) {
      this.finish.body.enable = false;
      this.finish.setVisible(false);
    }

    const groundY = 656;
    const groomX = Math.min(this.player.x, 10940);
    this.player.x = groomX;
    this.player.y = groundY;
    this.syncPlayerVisual();

    const brideX = Math.min(11110, groomX + 68);
    const rescuedBride = this.add.image(brideX, groundY, "bride")
      .setOrigin(0.5, 1)
      .setDisplaySize(56, 74)
      .setDepth(22);

    // A small celebratory burst of hearts around the couple.
    const heartOffsets = [
      [-48, -44], [-22, -74], [8, -56], [38, -82], [62, -48],
      [-34, -104], [18, -116], [52, -106], [0, -92]
    ];
    heartOffsets.forEach(([dx, dy], index) => {
      this.time.delayedCall(index * 80, () => {
        const heart = this.add.text((groomX + brideX) / 2 + dx, groundY + dy, "♥", {
          fontFamily: "Arial, sans-serif",
          fontSize: `${22 + (index % 3) * 4}px`,
          fontStyle: "bold",
          color: index % 2 === 0 ? "#d94d72" : "#f06f8f"
        }).setOrigin(0.5).setDepth(30);
        this.tweens.add({
          targets: heart,
          y: heart.y - 70 - (index % 3) * 12,
          x: heart.x + ((index % 2) ? 12 : -12),
          alpha: 0,
          scale: 1.35,
          duration: 1050,
          ease: "Cubic.Out",
          onComplete: () => heart.destroy()
        });
      });
    });

    this.showGameMessage("❤️ BRIDE RESCUED!", (groomX + brideX) / 2, groundY - 135);

    // Capture the score before the celebration delay so the animation does not
    // reduce the player's time bonus.
    const timeBonus = Math.max(0, Math.round((MAX_LEVEL_SECONDS - timeSeconds) * 40));
    const finishBonus = 1500;
    const total = Math.max(0, this.score + timeBonus + finishBonus);

    await new Promise((resolve) => this.time.delayedCall(1900, resolve));
    rescuedBride.destroy();

    ui.endBadge.textContent = "🔓 YOU RESCUED THE BRIDE!";
    ui.endTitle.textContent = "You opened the cage!";
    ui.scoreBreakdown.innerHTML = `
      <div class="score-row"><span>Rings</span><strong>${this.ringsCollected} × 100</strong></div>
      <div class="score-row"><span>Hearts collected</span><strong>${this.heartsCollected} × 300</strong></div>
      <div class="score-row"><span>Hearts remaining</span><strong>${this.heartShields}</strong></div>
      <div class="score-row"><span>Rescue bonus</span><strong>${finishBonus.toLocaleString()}</strong></div>
      <div class="score-row"><span>Time bonus</span><strong>${timeBonus.toLocaleString()}</strong></div>
      <div class="score-row score-total"><span>Total</span><strong>${total.toLocaleString()}</strong></div>
    `;
    ui.submitMessage.textContent = "Submitting score…";
    setGameUiActive(false);
    ui.endOverlay.classList.add("visible");

    try {
      const result = await submitScore({
        playerName,
        score: total,
        timeSeconds,
        rings: this.ringsCollected,
        hearts: this.heartsCollected
      });
      ui.submitMessage.textContent = result.mode === "supabase"
        ? "Score added to the live leaderboard."
        : "Saved in local test mode. Configure Supabase for shared scores.";
    } catch (error) {
      console.error(error);
      ui.submitMessage.textContent = "The game finished, but the score could not be submitted.";
    }
  }

  update() {
    if (!this.player || !this.running) return;

    const jump = touch.jump || this.cursors.up.isDown || this.keySpace.isDown;

    let moveAxis = 0;
    if (touch.moveX) moveAxis = touch.moveX;
    const keyLeft = this.cursors.left.isDown || this.keyA.isDown;
    const keyRight = this.cursors.right.isDown || this.keyD.isDown;
    if (keyLeft && !keyRight) moveAxis = -1;
    if (keyRight && !keyLeft) moveAxis = 1;

    const moveSpeed = this.superActive ? 315 : 245;
    if (moveAxis < -0.12) {
      this.player.setVelocityX(moveAxis * moveSpeed);
      this.facing = -1;
      if (this.playerVisual) this.playerVisual.setFlipX(true);
    } else if (moveAxis > 0.12) {
      this.player.setVelocityX(moveAxis * moveSpeed);
      this.facing = 1;
      if (this.playerVisual) this.playerVisual.setFlipX(false);
    } else {
      this.player.setVelocityX(0);
    }

    if (this.activeFlame && this.activeFlame.active) {
      this.positionActiveFlame();
    }

    if (this.superActive) {
      // Superhero flight uses the joystick as true vertical control:
      // up = climb, down = descend, and diagonals combine vertical + horizontal flight.
      const keyboardDown = this.cursors.down.isDown;
      this.player.body.allowGravity = false;
      if (touch.moveY > 0.2 || keyboardDown) {
        // Descending should feel deliberate and fast, rather than like the
        // gentle hands-off glide used when the stick is centred.
        this.player.setVelocityY(420);
      } else if (touch.moveY < -0.2 || jump) {
        this.player.setVelocityY(-260);
      } else {
        this.player.setVelocityY(70);
      }
      this.player.y = Phaser.Math.Clamp(this.player.y, 70, 628);
      this.jumpsUsed = 0;
      this.wasJumping = jump;
      touch.joystickJumpRequested = false;
    } else {
      this.player.body.allowGravity = true;
      const grounded = this.player.body.blocked.down || this.player.body.touching.down;
      if (grounded) this.jumpsUsed = 0;

      // Joystick-up is deliberately a SINGLE jump and only works from the ground.
      if (touch.joystickJumpRequested) {
        if (grounded) {
          this.player.setVelocityY(-510);
          this.jumpsUsed = 1;
        }
        touch.joystickJumpRequested = false;
      }

      // The dedicated JUMP button keeps the two-stage/double-jump behaviour:
      // tap once to jump and tap again while airborne for the second jump.
      if (jump && !this.wasJumping) {
        if (grounded) {
          this.player.setVelocityY(-510);
          this.jumpsUsed = 1;
        } else if (this.jumpsUsed < 2) {
          this.player.setVelocityY(-470);
          this.jumpsUsed = 2;
        }
      }
      this.wasJumping = jump;
    }

    if (this.superActive && !this.superCheat && performance.now() >= this.superUntil) {
      this.endSuperPower();
    }

    this.zombies.children.iterate((zombie) => {
      if (!zombie || !zombie.active) return;
      const homeX = zombie.getData("homeX");
      const range = zombie.getData("range");
      let direction = zombie.getData("direction") || 1;
      if (zombie.x > homeX + range) direction = -1;
      if (zombie.x < homeX - range) direction = 1;
      zombie.setData("direction", direction);
      zombie.setVelocityX(direction * 72);
      zombie.setFlipX(direction < 0);
    });

    this.seagulls.children.iterate((gull) => {
      if (!gull || !gull.active) return;
      const homeX = gull.getData("homeX");
      const homeY = gull.getData("homeY");
      const range = gull.getData("range");
      const speed = gull.getData("speed") || 82;
      const bob = gull.getData("bob") || 20;
      const phase = gull.getData("phase") || 0;
      let direction = gull.getData("direction") || 1;
      if (gull.x > homeX + range) direction = -1;
      if (gull.x < homeX - range) direction = 1;
      gull.setData("direction", direction);
      gull.setVelocityX(direction * speed);
      gull.setFlipX(direction < 0);

      // Keep the entire flight path inside Arcade Physics. Previously the
      // sprite's Y coordinate was overwritten manually every frame and then
      // its physics body was resynchronised, which could jitter on phones.
      const targetY = homeY + Math.sin((this.time.now / 850) + phase) * bob;
      const verticalSpeed = Phaser.Math.Clamp((targetY - gull.y) * 5, -70, 70);
      gull.setVelocityY(verticalSpeed);
    });

    this.syncPlayerVisual();

    this.updateCheckpoint();
    this.updateLevelProgress();

    if (this.player.y > 760) {
      if (this.superActive) {
        // Superhero mode is invulnerable: falling into a gap does not consume
        // a heart or end the run. Respawn at the last checkpoint with the
        // remaining superhero time intact.
        this.showGameMessage("⚡ SUPER SAVE!", this.checkpointX, 500);
        this.respawn();
      } else if (this.useHeartShield("fall")) {
        this.respawn();
      } else {
        this.gameOver("Se efage h marmagka!");
        return;
      }
    }

    if (this.elapsed() >= MAX_LEVEL_SECONDS) {
      this.respawn();
      this.startTime = performance.now();
      this.score = Math.max(0, this.score - 1000);
    }

    this.updateHud();
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  backgroundColor: "#cfeafd",
  physics: {
    default: "arcade",
    arcade: { gravity: { y: 1150 }, debug: false }
  },
  scale: {
    // FIT is more reliable than RESIZE when the game starts behind the
    // name-entry overlay. It preserves the 16:9 game world and scales it to
    // the available phone/laptop game area without producing a zero-size
    // renderer on some mobile browsers.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: WeddingScene,
  input: { activePointers: 3 }
};

new Phaser.Game(config);
setGameUiActive(false);
renderLeaderboard();
