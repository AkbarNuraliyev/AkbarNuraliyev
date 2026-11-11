import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Check, Crown, Factory, Globe, Package, ShoppingCart, Truck, Wrench, type LucideIcon } from "lucide-react";
import data from "./data.json";

export type Step = { image: string; box: { x: number; y: number; w: number; h: number } | null; caption: string; audio: string; dur: number };
export type Role = (typeof data)[number];

export const FPS = 30;
export const LEAD = 0.45; // seconds of picture before the narration starts
export const TAIL = 0.9; // seconds after the narration ends
export const TRANSITION = 12; // frames

const ICONS: Record<string, LucideIcon> = {
  "01-owner": Crown,
  "02-company-admin": Wrench,
  "03-department-manager": Factory,
  "04-employee-warehouse": Package,
  "05-driver": Truck,
  "06-b2b-customer": ShoppingCart,
  "07-super-admin": Globe,
};

const C = {
  bg1: "#0b2a20",
  bg2: "#11503a",
  brand: "#16a34a",
  accent: "#facc15",
  ink: "#0f172a",
  white: "#ffffff",
  soft: "rgba(255,255,255,0.78)",
};
const FONT = "'InterCyr', 'InterLat', sans-serif";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const smooth = Easing.bezier(0.16, 1, 0.3, 1);

export const introFrames = (r: Role) => Math.ceil((LEAD + r.introDur + 1.0) * FPS);
export const stepFrames = (s: Step) => Math.ceil((LEAD + s.dur + TAIL) * FPS);
export const outroFrames = (r: Role) => Math.ceil((LEAD + r.outroDur + 2.2) * FPS);
export const totalFrames = (r: Role) => {
  const parts = [introFrames(r), ...r.steps.map((s) => stepFrames(s as Step)), outroFrames(r)];
  return parts.reduce((a, b) => a + b, 0) - TRANSITION * (parts.length - 1);
};

const Background: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(circle at 20% 15%, ${C.bg2} 0%, ${C.bg1} 60%, #071a14 100%)` }} />
);

const Brand: React.FC<{ light?: boolean }> = () => (
  <div style={{ position: "absolute", top: 34, left: 48, display: "flex", alignItems: "center", gap: 14, color: C.white, fontFamily: FONT, fontSize: 30, fontWeight: 700 }}>
    <div style={{ width: 46, height: 46, borderRadius: 12, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>P</div>
    PoultryOS
    <span style={{ fontWeight: 500, color: C.soft, fontSize: 24 }}>· видеоинструкция</span>
  </div>
);

const Intro: React.FC<{ role: Role }> = ({ role }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const Icon = ICONS[role.key] ?? Globe;
  const pop = interpolate(f, [0, 0.7 * fps], [0.5, 1], { ...clamp, easing: Easing.spring({ damping: 200 }), output: "perceptual-scale" } as never);
  const show = (d: number) => ({ opacity: interpolate(f, [d * fps, (d + 0.5) * fps], [0, 1], clamp), translate: `0 ${interpolate(f, [d * fps, (d + 0.6) * fps], [30, 0], { ...clamp, easing: smooth })}px` });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.white, alignItems: "center", justifyContent: "center" }}>
      <Background />
      <Brand />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 34, textAlign: "center", padding: "0 160px" }}>
        <div style={{ width: 220, height: 220, borderRadius: 999, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", scale: String(pop), boxShadow: "0 30px 80px rgba(0,0,0,0.35)" }}>
          <Icon size={120} color={C.ink} strokeWidth={2.2} />
        </div>
        <div style={{ ...show(0.3), fontSize: 40, fontWeight: 600, color: C.accent, letterSpacing: 2, textTransform: "uppercase" }}>Роль</div>
        <div style={{ ...show(0.45), fontSize: 104, fontWeight: 800, lineHeight: 1.05 }}>{role.title}</div>
        <div style={{ ...show(0.8), fontSize: 46, fontWeight: 500, color: C.soft, maxWidth: 1400, lineHeight: 1.3 }}>{role.who}</div>
        <div style={{ ...show(1.3), marginTop: 10, fontSize: 30, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 999, padding: "14px 30px", color: C.white }}>
          Демо-вход: <b>{role.email}</b>
        </div>
      </div>
      <Sequence from={Math.round(LEAD * FPS)} layout="none">
        <Audio src={staticFile(role.introAudio)} />
      </Sequence>
    </AbsoluteFill>
  );
};

/** Pointer arrow drawn in SVG (no emoji font dependency). */
const Pointer: React.FC<{ x: number; y: number; press: number }> = ({ x, y, press }) => (
  <svg width={64} height={64} viewBox="0 0 24 24" style={{ position: "absolute", left: x - 8, top: y - 4, scale: String(1 - press * 0.15), filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))" }}>
    <path d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.6 20.1 L11.7 13.6 L18 13.6 Z" fill="#ffffff" stroke="#0f172a" strokeWidth={1.4} strokeLinejoin="round" />
  </svg>
);

type Geo = { W: number; H: number; vw: number; vh: number; maxZoom: number };

const ScreenWithFocus: React.FC<{ step: Step; geo: Geo; radius: number }> = ({ step, geo, radius }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { W, H, vw, maxZoom } = geo;
  const s0 = W / vw;
  const b = step.box;
  // target zoom and offset so the highlighted element sits in the middle
  let zT = 1;
  let txT = 0;
  let tyT = 0;
  if (b) {
    zT = Math.max(1, Math.min(maxZoom, (W * 0.62) / (b.w * s0), (H * 0.62) / (b.h * s0)));
    const cx = (b.x + b.w / 2) * s0;
    const cy = (b.y + b.h / 2) * s0;
    txT = Math.min(0, Math.max(W - W * zT, W / 2 - cx * zT));
    tyT = Math.min(0, Math.max(H - H * zT, H / 2 - cy * zT));
  }
  const k = interpolate(f, [0.25 * fps, 1.35 * fps], [0, 1], { ...clamp, easing: smooth });
  const z = 1 + (zT - 1) * k;
  const tx = txT * k;
  const ty = tyT * k;
  const rect = b ? { x: b.x * s0 * z + tx, y: b.y * s0 * z + ty, w: b.w * s0 * z, h: b.h * s0 * z } : null;
  const ring = interpolate(f, [1.1 * fps, 1.5 * fps], [0, 1], clamp);
  const pulse = 0.5 + 0.5 * Math.sin((f / fps) * Math.PI * 2 * 0.9);
  // pointer travels to the element and "clicks"
  const tgt = rect ? { x: rect.x + Math.min(rect.w / 2, 140), y: rect.y + Math.min(rect.h / 2, 70) } : { x: W / 2, y: H / 2 };
  const m = interpolate(f, [1.3 * fps, 2.1 * fps], [0, 1], { ...clamp, easing: smooth });
  const px = tgt.x + (1 - m) * 260;
  const py = tgt.y + (1 - m) * 200;
  const pointerOpacity = interpolate(f, [1.2 * fps, 1.45 * fps], [0, 1], clamp);
  const click = interpolate(f, [2.1 * fps, 2.7 * fps], [0, 1], clamp);
  const press = click > 0 && click < 0.35 ? 1 : 0;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: radius, background: "#fff" }}>
      <Img src={staticFile(step.image)} style={{ position: "absolute", left: 0, top: 0, width: W, transformOrigin: "0 0", translate: `${tx}px ${ty}px`, scale: String(z) }} />
      {rect && (
        <div
          style={{
            position: "absolute",
            left: rect.x - 6,
            top: rect.y - 6,
            width: rect.w + 12,
            height: rect.h + 12,
            borderRadius: 14,
            border: `${5 + pulse * 2}px solid ${C.accent}`,
            boxShadow: `0 0 0 4000px rgba(15,23,42,${0.42 * ring}), 0 0 ${18 + pulse * 22}px rgba(250,204,21,0.85)`,
            opacity: ring,
          }}
        />
      )}
      {rect && click > 0 && click < 1 && (
        <div style={{ position: "absolute", left: tgt.x - 50 * click - 4, top: tgt.y - 50 * click - 4, width: 100 * click + 8, height: 100 * click + 8, borderRadius: 999, border: `6px solid ${C.accent}`, opacity: 1 - click }} />
      )}
      {rect && <div style={{ opacity: pointerOpacity }}><Pointer x={px} y={py} press={press} /></div>}
    </div>
  );
};

const StepBadge: React.FC<{ n: number; total: number }> = ({ n, total }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <div style={{ minWidth: 76, height: 76, borderRadius: 999, background: C.accent, color: C.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800 }}>{n}</div>
    <div style={{ fontSize: 24, color: C.soft, fontWeight: 600, whiteSpace: "nowrap" }}>из {total}</div>
  </div>
);

const Progress: React.FC<{ n: number; total: number }> = ({ n, total }) => (
  <div style={{ display: "flex", gap: 8 }}>
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} style={{ width: 26, height: 8, borderRadius: 8, background: i < n ? C.accent : "rgba(255,255,255,0.25)" }} />
    ))}
  </div>
);

const StepScene: React.FC<{ role: Role; step: Step; n: number; total: number }> = ({ role, step, n, total }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cap = { opacity: interpolate(f, [0.15 * fps, 0.6 * fps], [0, 1], clamp), translate: `0 ${interpolate(f, [0.15 * fps, 0.7 * fps], [24, 0], { ...clamp, easing: smooth })}px` };
  const audio = (
    <Sequence from={Math.round(LEAD * FPS)} layout="none">
      <Audio src={staticFile(step.audio)} />
    </Sequence>
  );
  if (role.mobile) {
    const H = 940;
    const W = Math.round((H * role.viewport.width) / role.viewport.height);
    return (
      <AbsoluteFill style={{ fontFamily: FONT, color: C.white }}>
        <Background />
        <div style={{ position: "absolute", left: 250, top: (1080 - H) / 2 - 14, width: W + 28, height: H + 28, borderRadius: 64, background: "#0b0f14", boxShadow: "0 40px 90px rgba(0,0,0,0.5)", padding: 14 }}>
          <div style={{ position: "relative", width: W, height: H }}>
            <ScreenWithFocus step={step} geo={{ W, H, vw: role.viewport.width, vh: role.viewport.height, maxZoom: 1.45 }} radius={50} />
          </div>
        </div>
        <div style={{ position: "absolute", left: 860, right: 110, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <StepBadge n={n} total={total} />
            <Progress n={n} total={total} />
          </div>
          <div style={{ ...cap, fontSize: 68, fontWeight: 800, lineHeight: 1.15 }}>{step.caption}</div>
          <div style={{ fontSize: 30, color: C.soft }}>{role.title}</div>
        </div>
        {audio}
      </AbsoluteFill>
    );
  }
  const W = 1504;
  const H = Math.round((W * role.viewport.height) / role.viewport.width);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.white }}>
      <Background />
      <div style={{ position: "absolute", left: (1920 - W) / 2, top: 26, width: W, height: H, borderRadius: 18, boxShadow: "0 30px 70px rgba(0,0,0,0.45)", outline: "1px solid rgba(255,255,255,0.15)" }}>
        <ScreenWithFocus step={step} geo={{ W, H, vw: role.viewport.width, vh: role.viewport.height, maxZoom: 1.7 }} radius={18} />
      </div>
      <div style={{ position: "absolute", left: (1920 - W) / 2, width: W, top: 26 + H + 20, bottom: 22, display: "flex", alignItems: "center", gap: 30 }}>
        <StepBadge n={n} total={total} />
        <div style={{ ...cap, flex: 1, fontSize: 50, fontWeight: 800, lineHeight: 1.12 }}>{step.caption}</div>
        <Progress n={n} total={total} />
      </div>
      {audio}
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ role: Role }> = ({ role }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const item = (i: number) => {
    const d = (0.8 + i * 0.9) * fps;
    return {
      opacity: interpolate(f, [d, d + 0.4 * fps], [0, 1], clamp),
      scale: String(interpolate(f, [d, d + 0.5 * fps], [0.85, 1], { ...clamp, easing: Easing.spring({ damping: 200 }), output: "perceptual-scale" } as never)),
    };
  };
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.white, alignItems: "center", justifyContent: "center" }}>
      <Background />
      <Brand />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 46 }}>
        <div style={{ fontSize: 112, fontWeight: 800, opacity: interpolate(f, [0, 0.4 * fps], [0, 1], clamp) }}>Запомни!</div>
        <div style={{ display: "flex", gap: 34 }}>
          {role.points.map((p, i) => (
            <div key={p} style={{ ...item(i), width: 470, minHeight: 250, borderRadius: 28, background: C.white, color: C.ink, padding: 34, display: "flex", flexDirection: "column", gap: 22, boxShadow: "0 30px 70px rgba(0,0,0,0.35)" }}>
              <div style={{ width: 70, height: 70, borderRadius: 999, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Check size={44} color="#fff" strokeWidth={3} />
              </div>
              <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15 }}>{p}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 32, color: C.soft, opacity: interpolate(f, [3.6 * fps, 4.1 * fps], [0, 1], clamp) }}>
          Попробуй сам в демо: <b style={{ color: C.white }}>{role.email}</b>
        </div>
      </div>
      <Sequence from={Math.round(LEAD * FPS)} layout="none">
        <Audio src={staticFile(role.outroAudio)} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const RoleGuide: React.FC<{ roleKey: string }> = ({ roleKey }) => {
  const role = data.find((r) => r.key === roleKey)!;
  const steps = role.steps as Step[];
  const t = linearTiming({ durationInFrames: TRANSITION });
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Intro" durationInFrames={introFrames(role)}>
        <Intro role={role} />
      </TransitionSeries.Sequence>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Transition presentation={fade()} timing={t} />
          <TransitionSeries.Sequence name={`Step ${i + 1}`} durationInFrames={stepFrames(s)}>
            <StepScene role={role} step={s} n={i + 1} total={steps.length} />
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
      <TransitionSeries.Transition presentation={fade()} timing={t} />
      <TransitionSeries.Sequence name="Outro" durationInFrames={outroFrames(role)}>
        <Outro role={role} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
