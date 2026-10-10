// Лёгкое конфетти на canvas

const canvas = document.getElementById('confetti');
const ctx = canvas.getContext('2d');
let parts = [];
let running = false;

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function palette() {
  const cs = getComputedStyle(document.documentElement);
  return ['--b1', '--b2', '--b3', '--b4', '--accent'].map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
}

export function burst(x, y, count = 40, big = false) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = palette();
  for (let i = 0; i < count; i++) {
    const a = big ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
    const sp = (big ? 6 : 4) + Math.random() * (big ? 9 : 6);
    parts.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - (big ? 3 : 1),
      w: 4 + Math.random() * 5,
      h: 7 + Math.random() * 7,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[i % colors.length],
      life: 0,
      max: 70 + Math.random() * 50,
      round: Math.random() < 0.3,
    });
  }
  if (!running) { running = true; requestAnimationFrame(loop); }
}

function loop() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life < p.max);
  for (const p of parts) {
    p.life++;
    p.vy += 0.22;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.c;
    if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 1.6, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 8)));
    ctx.restore();
  }
  if (parts.length) requestAnimationFrame(loop);
  else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}
