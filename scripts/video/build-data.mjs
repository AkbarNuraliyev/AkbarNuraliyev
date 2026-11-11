// Combines capture manifests + narration durations into the Remotion project's data file
// and copies screenshots / audio into its public folder.
import fs from "node:fs";
import path from "node:path";
const [capDir, voiceDir, projDir] = process.argv.slice(2);
const voice = JSON.parse(fs.readFileSync(path.join(voiceDir, "voice.json"), "utf8"));
const roles = [];
for (const key of fs.readdirSync(capDir).filter((k) => fs.existsSync(path.join(capDir, k, "manifest.json"))).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(capDir, key, "manifest.json"), "utf8"));
  const v = voice[key];
  fs.mkdirSync(path.join(projDir, "public", "cap", key), { recursive: true });
  fs.mkdirSync(path.join(projDir, "public", "voice", key), { recursive: true });
  for (const f of fs.readdirSync(path.join(capDir, key)).filter((f) => f.endsWith(".png"))) fs.copyFileSync(path.join(capDir, key, f), path.join(projDir, "public", "cap", key, f));
  for (const f of fs.readdirSync(path.join(voiceDir, key))) fs.copyFileSync(path.join(voiceDir, key, f), path.join(projDir, "public", "voice", key, f));
  const bad = m.steps.filter((s) => s.error);
  if (bad.length) console.warn(`${key}: ${bad.length} step(s) had capture errors`);
  roles.push({
    ...m,
    introAudio: `voice/${v.intro.file}`, introDur: v.intro.duration,
    outroAudio: `voice/${v.outro.file}`, outroDur: v.outro.duration,
    steps: m.steps.map((s, i) => { const a = v[String(i + 1).padStart(2, "0")]; return { ...s, image: `cap/${s.image}`, audio: `voice/${a.file}`, dur: a.duration }; }),
  });
}
fs.writeFileSync(path.join(projDir, "src", "data.json"), JSON.stringify(roles, null, 2));
console.log(`${roles.length} roles written`);
