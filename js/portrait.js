// Ritratti procedurali degli agenti, condivisi tra HUD di gioco e schermate.
const SKINS = ['#d9a98a', '#c18f6d', '#8d5a3b', '#e6c4a6'];

/** Disegna un busto cibernetico su un canvas 64×64 a partire dal nome. */
export function drawAgentPortrait(c, name, accent = '#37e1ff') {
  c.clearRect(0, 0, 64, 64);
  const g = c.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#12263a'); g.addColorStop(1, '#0a1220');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#16283f'; c.beginPath(); c.moveTo(6, 64); c.quadraticCurveTo(32, 36, 58, 64); c.fill();
  c.strokeStyle = accent; c.lineWidth = 1.5; c.beginPath(); c.moveTo(14, 64); c.quadraticCurveTo(32, 44, 50, 64); c.stroke();
  const skin = SKINS[(name.charCodeAt(0) + name.length) % 4];
  c.fillStyle = skin; c.beginPath(); c.ellipse(32, 29, 12, 14, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1a1a22'; c.beginPath(); c.ellipse(32, 22, 13, 9, 0, Math.PI, Math.PI * 2); c.fill();
  c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = 8; c.fillRect(20, 27, 24, 4); c.shadowBlur = 0;
}
