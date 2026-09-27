# Alex & Antonia — Wedding Adventure

A browser-based wedding platform game designed for guests to play on their phones.

## Stack

- Static hosting: Cloudflare Pages **or** GitHub Pages
- Game engine: Phaser 3
- Leaderboard: Supabase
- Controls: virtual joystick + Jump/Fire buttons, plus keyboard controls for testing
- No native app and no installation required

## 1. Test locally

Because ES modules are used, serve the folder with a small HTTP server rather than opening `index.html` directly.

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

Until Supabase is configured, the game uses a local browser-only test leaderboard.

## Unique player names

The leaderboard treats player names as unique, case-insensitively. For example, `Alex`, `alex`, and ` ALEX ` are the same player. Only that player's best score is kept. If two attempts have the same score, the faster completion time is kept.

If you already created the Supabase table using an earlier version of this project, run the current `supabase.sql` again. It migrates existing scores, removes duplicate names while keeping the highest score, and installs the best-score submission function.

## 2. Create the Supabase leaderboard

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run `supabase.sql`.
4. Go to the project's API settings.
5. Copy the **Project URL** and the **anon/public (publishable) key**.
6. Put them in `config.js`:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR_PUBLIC_ANON_KEY";
```

Never put a `service_role` key in browser code. The public key is intended to be exposed client-side when Row Level Security is configured, which `supabase.sql` does.

## 3A. Deploy with Cloudflare Pages

1. Push this folder to a GitHub repository.
2. In Cloudflare, create a Pages project and connect the repository.
3. Framework preset: **None**.
4. Build command: leave blank.
5. Build output directory: `.`
6. Deploy.

Cloudflare will give you a URL such as:

```text
https://wedding-adventure.pages.dev
```

## 3B. Deploy with GitHub Pages

1. Push the files to a GitHub repository.
2. Open **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select `main` and `/ (root)`.
5. Save.

GitHub will publish a URL such as:

```text
https://USERNAME.github.io/wedding-adventure/
```

## 4. Wedding-day flow

1. Put the public URL into a QR code.
2. Guests scan it using their normal phone camera.
3. The link opens in Safari/Chrome.
4. They enter their name and press **Start game**.
5. They use the virtual joystick and on-screen Jump/Fire controls.
6. Their score is submitted to Supabase.
7. Everyone sees the same Top 10 leaderboard.

## Scoring

- Ring: +100
- Heart: +300 **and one Love Shield charge**
- A heart is consumed by the next cat, zombie hit, or fall
- If the heart count is already 0, the next hit/fall ends the run
- Reaching the bride: +1,500
- Faster finishes receive a larger time bonus

## Files

- `index.html` — page structure
- `styles.css` — responsive phone UI
- `game.js` — Phaser game and touch controls
- `leaderboard.js` — Supabase/local leaderboard logic
- `config.js` — Supabase credentials and game settings
- `supabase.sql` — database table and RLS policies

## Important note about cheating

This is a casual wedding game, so score calculation happens in the browser. A technically knowledgeable guest could manipulate a score using browser developer tools. If you want stronger anti-cheat protection, move final score validation to a Cloudflare Worker / Supabase Edge Function.


## Controls

On phones, use the **8-way virtual joystick** to move. Push up, up-left, or up-right for a **single jump** while keeping horizontal movement. The **JUMP ×2** button supports a double jump: press it once to jump and again while airborne for the second jump. During superhero mode the joystick becomes full flight control: **up climbs, down descends, and diagonal directions fly diagonally**. Keyboard testing supports arrow keys/A-D and Space/Up; Down descends during superhero flight.

## Hearts / Love Shields

Each heart gives +300 points and one protection charge. Hitting a cat or zombie consumes one heart and bounces the player away. Falling into a gap consumes one heart and respawns the player at the latest checkpoint. If no hearts remain, the next hit or fall ends the run.

The final level ends when the player finds the key and opens the bride’s cage.

## Gameplay update: hearts and zombies
- Hearts now act as protection. A hit/fall consumes one heart if available.
- If the player has 0 hearts, the next hit or fall ends the run with Game Over.
- Game-over attempts are not submitted to the leaderboard.
- Cartoon zombies patrol the level. Jumping on a zombie defeats it for +500 points; touching one from the side costs a heart or causes Game Over when no hearts remain.
- Static ground obstacles are cats. They cost one heart, or cause Game Over when no hearts remain.
- Falling into a gap with no hearts ends the run with the message `Se efage h marmagka`.

## Flamethrower

Each run starts with **1 flamethrower charge**. On a phone, use the **🔥 FIRE** button; on a keyboard use **F**. The flame plume stays next to the groom for about 2 seconds and defeats any Frankenstein-style monster that touches it for +500 points. One fuel pickup can restore the charge.


## Superhero power-up

The game contains one harder-to-reach superhero-style **S shield** collectible. Picking it up grants **10 seconds** of powered mode:

- use joystick **up/down** to climb or descend, including diagonal flight; holding **JUMP** also flies upward
- left/right continue to steer
- the FIRE button changes to **LASER**
- laser shots are unlimited during the 10-second power-up and destroy Frankenstein-style zombies for +500 points
- when the timer expires, the groom returns to normal and the single-charge flamethrower returns

The HUD shows the remaining powered-mode seconds next to the 🦸 icon.


## Four-level structure

The game is now one continuous four-stage run:

- Level 1: opening section
- Level 2: harder platforming and hazards
- Level 3: later challenge section
- Level 4: final rescue section with the key and the bride's cage

The HUD shows the current level. Crossing into a new level awards a small level bonus and displays a level banner. The final score is only submitted after the bride is rescued in Level 4.

## Player name

The name field defaults to **Aimilia**. After the first start, the chosen name is remembered in that browser using `localStorage`. **Play again** immediately starts another run with the same player name instead of showing the name-entry form again.


## Airborne enemies

Cartoon seagulls patrol the upper sky lanes at different heights. Contact costs a heart shield (or ends the run at zero hearts); they can be stomped from above or defeated by the flamethrower and superhero lasers for +500 points.


## Mobile control notes

- In superhero mode, joystick up climbs and joystick down descends faster; diagonals combine horizontal and vertical flight.
- On portrait phones, the start and result screens use a full-width normal page layout with natural page scrolling; the game canvas is hidden while those screens are open.
