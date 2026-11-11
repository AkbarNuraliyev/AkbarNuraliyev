// Generates the Russian narration for every storyboard step with RHVoice (offline TTS).
// Usage: node scripts/video/voice.mjs <outDir> [voice=elena] [rate=92]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROLES } from "./storyboards.mjs";

const [outDir, voice = "elena", rate = "92"] = process.argv.slice(2);
const result = {};
for (const role of ROLES) {
  const dir = path.join(outDir, role.key);
  fs.mkdirSync(dir, { recursive: true });
  const parts = [["intro", role.intro], ...role.steps.map((s, i) => [String(i + 1).padStart(2, "0"), s.say]), ["outro", role.outro]];
  result[role.key] = {};
  for (const [name, text] of parts) {
    const file = path.join(dir, `${name}.wav`);
    execFileSync("RHVoice-test", ["-p", voice, "-r", rate, "-o", file], { input: text });
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
    result[role.key][name] = { file: `${role.key}/${name}.wav`, duration: dur };
  }
  const total = Object.values(result[role.key]).reduce((s, x) => s + x.duration, 0);
  console.log(`${role.key}: ${parts.length} clips, ${total.toFixed(1)} s of speech`);
}
fs.writeFileSync(path.join(outDir, "voice.json"), JSON.stringify(result, null, 2));
