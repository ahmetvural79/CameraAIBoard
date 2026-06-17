# CameraAIBoard ✋➗

> **Draw math in the air with your finger — AI reads it and writes the answer back on screen.**

You write in the air **with your finger** in front of the camera; the app tracks
your hand in real time, draws your strokes, then reads the equation with
**Claude** (vision/OCR) and writes the result back onto the board in a
handwriting style. Both arithmetic (`12 + 7 =`) and **equations in x**
(`2x + 3 = 7`, `x² − 5x + 6 = 0`) are supported.

It uses **Google MediaPipe Hand Landmarker** (real-time, 21-point hand tracking)
in the browser + the **Claude Opus 4.8** vision model on the server.

---

## ✨ Features

- 🖐️ **Hands-free:** no mouse/keyboard — everything is driven by hand gestures.
- ✏️ **Smooth drawing:** One-Euro filter + curve smoothing for jitter-free, continuous strokes.
- 🧽 **Erase & clear:** with hand gestures.
- 🎨 **Pick colors by hand:** point at a swatch and dwell briefly to select it.
- 🤖 **AI solving:** reads the equation off the board and writes the answer next to it.
- 🔢 **Arithmetic + algebra:** four operations, powers, parentheses **and solving for x**.
- ✅ **Correction:** if a digit is misread, edit the recognized expression and recompute instantly.

## ✋ Gestures

| Gesture | Action |
| --- | --- |
| ☝️ Single finger (index) | **Draw** in the selected color |
| 🖐️ Open hand | **Erase** |
| 👍 Thumbs-up (hold briefly) | **Solve** — sends the board to Claude |
| 👎 Thumbs-down (hold briefly) | **Clear** the board |
| 🎨 Hold index finger on a swatch ~0.5 s | **Pick color** |

> Flow: write the equation (e.g. `2x + 3 = 7`), then thumbs-up → Claude reads it
> and writes the result (`x = 2`) next to the equation.

## 🧠 Architecture

```
browser (public/)                          server (server.js)
  ├─ MediaPipe HandLandmarker  ── hand ┐
  ├─ filters.js   (One-Euro)           │
  ├─ gestures.js  (gesture classify)   │
  ├─ canvas.js    (draw/erase/answer)  │
  └─ solver.js ── PNG / text ─────────►├─ POST /api/solve
                                        └─ Anthropic SDK → claude-opus-4-8 (vision)
                                           → {found, type, equation, answer}
```

- Hand tracking runs entirely **in the browser** (WebGL/WASM); only on **Solve**
  is the board image sent to the server.
- **The API key stays on the server** and is never exposed to the browser.
- To keep the picture sharp, hand tracking runs on a separate small canvas →
  crisp video + low latency.

## 🛠 Tech stack

- **Hand tracking:** [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) (HandLandmarker)
- **AI:** [Anthropic Claude](https://www.anthropic.com/) (Opus 4.8, vision)
- **Server:** Node.js + Express
- **Frontend:** build-less vanilla JavaScript (ES modules) + Canvas API

## 🚀 Getting started

Requirements: **Node.js 18+** and a Claude API key.

```bash
git clone https://github.com/ahmetvural79/CameraAIBoard.git
cd CameraAIBoard
npm install
cp .env.example .env        # then put your ANTHROPIC_API_KEY in .env
npm start
```

Open **http://localhost:3000** in your browser, click **Start Camera**, and
grant camera permission. (The page is served over `localhost` so the camera
works in a secure context.)

You can also pass the key inline:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

## ⚙️ Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | **Required.** Your Claude API key |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Any vision-capable Claude model |
| `PORT` | `3000` | Server port |

## 📁 Project structure

```
CameraAIBoard/
├─ server.js            Express + Anthropic proxy (/api/solve)
├─ package.json
├─ .env.example
└─ public/
   ├─ index.html
   ├─ styles.css
   ├─ app.js            camera + MediaPipe loop + UI orchestration
   ├─ filters.js        One-Euro smoothing filter
   ├─ gestures.js       21 landmarks → gesture classification
   ├─ canvas.js         draw/erase/clear + answer rendering
   └─ solver.js         /api/solve call + local safe evaluator
```

## 💡 Tips

- For best recognition, write digits **large and clearly** and pick a bold pen color.
- Use `x` / `*` for multiply, `/` for divide, `^` for power, `( )` for parentheses.
- If drawing still feels jittery, tune `FILTER_OPTS`, `DRAW_GRACE`, and `INF_W`
  at the top of `public/app.js`.

## 🔒 Security

Your API key is kept only on the server (`.env`); `.env` is in `.gitignore` and
is never sent to the browser. **Do not put a real key in `.env.example`** — it is
only a template.

## 📄 License

[MIT](LICENSE)
