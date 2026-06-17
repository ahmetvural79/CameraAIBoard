import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const SYSTEM_PROMPT =
  "You are a precise OCR-and-math engine for a finger-drawing whiteboard app. " +
  "A person draws a handwritten math problem with their finger, so the strokes are rough and uneven. " +
  "Read it as accurately as you can and solve it exactly.";

const VISION_PROMPT = `The image shows a hand-drawn math problem on a white whiteboard (colored finger strokes). It is ONE of:
(a) an ARITHMETIC expression, optionally ending with "=" (e.g. 12 + 7 =), or
(b) an EQUATION containing the unknown x (and maybe y) with an "=" sign (e.g. 2x + 3 = 7, or x^2 - 5x + 6 = 0).

Reading rules:
- Digits 0-9. Operators: + , - (or —), multiply (× x * ·), divide (÷ /), power ^, parentheses ( ).
- The letter "x" can be the multiplication sign OR the unknown. Decide from context: if there is an "=" with terms on both sides and a letter present, treat that letter as the unknown variable.
- Handwriting is rough; infer the most plausible problem.

Respond with ONLY one minified JSON object, no markdown and no prose, exactly:
{"found": true|false, "type": "arithmetic"|"equation", "equation": "<what you read, normalized>", "answer": "<short result string to display>"}

- ARITHMETIC: "equation" = the expression (keep or drop a trailing "="); "answer" = just the number, e.g. "19".
- EQUATION in x: "equation" = the full equation as read (e.g. "2x + 3 = 7"); "answer" = the solution to display, e.g. "x = 2" (use "x = 2, x = -3" for multiple real roots; "no real solution" if none). Round to at most 4 decimals.
- Unreadable: {"found": false, "type": "arithmetic", "equation": "", "answer": ""}.
Compute exactly.`;

const textPrompt = (eq) =>
  `Solve the following. It is either an arithmetic expression or an equation to solve for x.
Input: ${eq}

Respond with ONLY one minified JSON object: {"found": true|false, "type": "arithmetic"|"equation", "equation": "<normalized>", "answer": "<short result, e.g. 19 or x = 2>"}.
For arithmetic, "answer" is just the number. For an equation in x, "answer" is like "x = 2" (or "x = 2, x = -3"). Round to at most 4 decimals. Compute exactly.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function askClaude(content) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { json: extractJson(text), text };
}

app.post("/api/solve", async (req, res) => {
  if (!client) {
    return res.status(500).json({
      error:
        "ANTHROPIC_API_KEY is not set. Add your key to the .env file before starting the server.",
    });
  }

  const { image, equation } = req.body || {};

  let content;
  if (typeof equation === "string" && equation.trim()) {
    // Metinle çözme (düzeltme kutusundan gelen x'li / aritmetik ifade)
    content = [{ type: "text", text: textPrompt(equation.trim().slice(0, 400)) }];
  } else if (typeof image === "string" && image.startsWith("data:image/")) {
    const comma = image.indexOf(",");
    const meta = image.slice(5, image.indexOf(";"));
    const data = image.slice(comma + 1);
    content = [
      { type: "image", source: { type: "base64", media_type: meta, data } },
      { type: "text", text: VISION_PROMPT },
    ];
  } else {
    return res.status(400).json({ error: "Invalid request (image or expression required)." });
  }

  try {
    const { json, text } = await askClaude(content);
    if (!json) {
      return res.status(502).json({ error: "Could not parse the model response.", raw: text });
    }
    return res.json(json);
  } catch (err) {
    console.error("solve error:", err);
    const status = err?.status || 500;
    return res.status(status).json({ error: err?.message || "Claude request failed." });
  }
});

app.listen(PORT, () => {
  const keyState = client ? "✓ set" : "✗ MISSING (.env)";
  console.log(`\n  CameraAIBoard running →  http://localhost:${PORT}`);
  console.log(`  Model: ${MODEL}   |   ANTHROPIC_API_KEY: ${keyState}\n`);
});
