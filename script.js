const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- ASSET CONFIGURATION ---
const ASSETS = {
    boss: new Image(),
    enemy: new Image()
};
ASSETS.enemy.src = './images/enemy.png';
const BOSS_IMAGES = [
    './images/boss1.png',
    './images/boss2.png',
    './images/boss3.png',
    './images/boss4.png',
    './images/boss5.png',
    './images/boss6.png',
    './images/boss7.png',
    './images/boss8.png',
    './images/boss9.png',
    './images/boss10.png'

];

// --- MUSIC CONFIGURATION ---
const MUSIC = {
    boss: './music/boss.mp3', // shared boss track
    stageTracks: [
        './music/stage1.mp3',
        './music/stage2.mp3',
        './music/stage3.mp3',
        './music/stage4.mp3',
        './music/stage5.mp3',
        './music/stage6.mp3',
        './music/stage7.mp3',
        './music/stage8.mp3',
        './music/stage9.mp3',
        './music/stage10.mp3'
    ]
};

let currentTrack = null;
function playMusic(src) {
    stopMusic();
    currentTrack = new Audio(src);
    currentTrack.loop = true;
    currentTrack.volume = 0.5;
    currentTrack.play();
}
function stopMusic() {
    if (currentTrack) {
        currentTrack.pause();
        currentTrack.currentTime = 0;
        currentTrack = null;
    }
}





// --- ENGINE STATE ---
const BOSS_TIME = 600; // 10 minutes (600 seconds)
const CYCLE_TIME = 120; // 2 minutes
let state = {
    active: true, stage: parseInt(localStorage.getItem('neonStage')) || 1, 
    score: parseInt(localStorage.getItem('neonScore')) || 0, lives: 3, time: 0,
    isDay: true, scroll: 0, bossActive: false, bossHp: 100, shake: 0
};

const keys = {};
const hero = { x: 200, y: 0, w: 40, h: 80, vx: 0, vy: 0, hp: 100, grounded: false, cd: 0, dir: 1, anim: 0 };
let projectiles = [], particles = [], hazards = [], enemies = [], bossAttacks = [];

// --- SOUND ENGINE (Synth-based) ---
const SFX = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    play(freq, type, dur, vol=0.1) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
        g.gain.setValueAtTime(vol, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + dur);
    }
};

// --- CLASSES ---
class BrickWall {
    constructor(x, type='wall') {
        this.x = x; this.type = type;
        this.w = 50; this.h = type === 'spike' ? 60 : 150;
        this.y = canvas.height - 120 - this.h;
    }
    update(speed) {
        if(!state.bossActive) this.x -= speed;
        if(hero.x < this.x + this.w && hero.x + hero.w > this.x && hero.y < this.y + this.h && hero.y + hero.h > this.y) {
            hero.hp -= 0.5; state.shake = 5;
            if(Math.random() > 0.95) SFX.play(100, 'sawtooth', 0.1);
        }
        return this.x < -100;
    }
    draw() {
        ctx.save();
        ctx.fillStyle = "#4a0000"; ctx.fillRect(this.x, this.y, this.w, this.h);
        const bw = 12, bh = 8;
        for(let i=0; i<this.h; i+=bh) {
            let offset = (i/bh % 2 === 0) ? 0 : bw/2;
            for(let j=0; j<this.w; j+=bw) {
                ctx.fillStyle = "#8B0000";
                ctx.fillRect(this.x + j + offset, this.y + i, bw-1, bh-1);
                if(!state.isDay) { ctx.strokeStyle = "var(--pink)"; ctx.lineWidth = 0.5; ctx.strokeRect(this.x+j+offset, this.y+i, bw-1, bh-1); }
            }
        }
        ctx.restore();
    }
}

class Enemy {
    constructor(x) {
        this.x = x; this.y = canvas.height - 170;
        this.dying = false; this.alpha = 1; this.vx = -4;
    }
    update() {
        if(!this.dying) {
            this.x += this.vx;
            hazards.forEach(h => { if(this.x < h.x + h.w && this.x + 40 > h.x) this.vx *= -1; });
            if(Math.abs(this.x - hero.x) < 40 && Math.abs(this.y - hero.y) < 60) hero.hp -= 0.2;
        } else { this.alpha -= 0.1; }
        return this.x < -200 || this.alpha <= 0;
    }
    die() {
        this.dying = true; state.score += 150;
        SFX.play(150, 'square', 0.2); 
        for(let i=0; i<15; i++) particles.push(new Particle(this.x, this.y));
    }
    draw() { ctx.globalAlpha = this.alpha; ctx.drawImage(ASSETS.enemy, this.x, this.y, 50, 50); ctx.globalAlpha = 1; }
}

class Projectile {
    constructor(x, y, vx, type, owner='hero') {
        this.x = x; this.y = y; this.vx = vx; this.type = type; this.owner = owner;
        this.size = type === 'wide' ? 40 : (type === 'heavy' ? 12 : 6);
    }
    update() {
        this.x += this.vx;
        if(this.owner === 'hero') {
            enemies.forEach(en => { if(!en.dying && Math.abs(this.x - en.x) < 40 && Math.abs(this.y - en.y) < 40) { en.die(); this.dead = true; }});
            if(state.bossActive && this.x > canvas.width - 250) {
                state.bossHp -= (this.type === 'heavy' ? 1.5 : (this.type === 'wide' ? 0.8 : 0.4));
                this.dead = true; state.score += 10;
                SFX.play(600, 'sine', 0.05);
            }
        } else { // Boss Attack Collision
            if(Math.abs(this.x - hero.x) < 40 && Math.abs(this.y - (hero.y + 40)) < 60) {
                hero.hp -= (this.type === 'fire' ? 15 : 25); state.shake = 10; this.dead = true;
            }
        }
        return this.dead || this.x < -100 || this.x > canvas.width + 100;
    }
    draw() {
        ctx.shadowBlur = 10; ctx.shadowColor = this.owner === 'hero' ? 'var(--cyan)' : 'var(--red)';
        ctx.fillStyle = ctx.shadowColor;
        if(this.type === 'wide') ctx.fillRect(this.x, this.y - 20, 10, 40);
        else { ctx.beginPath(); ctx.arc(this.x, this.y, this.size, 0, Math.PI*2); ctx.fill(); }
    }
}

class Particle {
    constructor(x, y) { this.x = x; this.y = y; this.vx = (Math.random()-0.5)*15; this.vy = (Math.random()-0.5)*15; this.life = 1; }
    update() { this.x += this.vx; this.y += this.vy; this.life -= 0.03; }
    draw() { ctx.fillStyle = `rgba(0, 242, 255, ${this.life})`; ctx.fillRect(this.x, this.y, 4, 4); }
}

// --- BOSS LOGIC ---
const BOSS_NAMES = ["TITAN ARCHON", "WALL CRUSHER", "NEON OVERLORD", "PHANTOM KING", "CYBER DRAGON", "VOID TITAN", "PLASMA BEAST", "STORM BRINGER", "OMEGA MECH", "ZENITH PRIME"];

class TitanBoss {
    constructor() {
        this.w = 200; this.h = 250;
        this.x = canvas.width + 300; this.y = canvas.height - 350;
        this.targetX = canvas.width - 250;
        this.atkTimer = 0;
        this.name = BOSS_NAMES[state.stage - 1] || "THE ANCIENT ONE";
    }
    update() {
        if(this.x > this.targetX) this.x -= 2; // Arrive in position
        
        // Difficulty scaling: boss attacks faster as HP drops and as stage increases
        const hpPercent = state.bossHp / 100;
        const cooldown = (120 - (state.stage * 5)) * hpPercent;
        
        this.atkTimer++;
        if(this.atkTimer > Math.max(30, cooldown)) {
            this.attack();
            this.atkTimer = 0;
        }
    }
    attack() {
        const roll = Math.random();
        SFX.play(100, 'sawtooth', 0.5, 0.2); // Roar effect
        
        if (roll < 0.3) { // Fireball
            bossAttacks.push(new Projectile(this.x,  canvas.height - 150, -10 - state.stage, 'fire', 'boss'));
        } else if (roll < 0.6) { // Spike Throw
            bossAttacks.push(new Projectile(this.x,  canvas.height - 180, -8, 'spike', 'boss'));
        } else if (roll < 0.85) { // Wall Summon
            hazards.push(new BrickWall(hero.x + 500, 'wall'));
        } else { // Energy Blast (Stage 2+)
            state.shake = 20;
            bossAttacks.push(new Projectile(this.x, 0, -15, 'wide', 'boss')); // Wide area blast
        }
    }
    draw() { ctx.drawImage(ASSETS.boss, this.x, this.y, this.w, this.h); }
}

// --- ENGINE CORE ---
let boss;
function mainLoop() {
    if(!state.active) return;
    // ✅ Responsive canvas width
    if (window.innerWidth < 900) {
        // Mobile: fixed logical width for more play space
        canvas.width = 800;
        canvas.height = 1300;
    } else {
        // Desktop: use full window width
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    
    const groundY = canvas.height - 120;
    state.time++;
    state.isDay = Math.floor(state.time / 60 / CYCLE_TIME) % 2 === 0;

    renderBackground(groundY);

    // Hero Logic
    if(hero.cd > 0) hero.cd--;
    if(keys['ArrowRight']) { hero.vx = 7; hero.dir = 1; hero.anim += 0.2; }
    else if(keys['ArrowLeft']) { hero.vx = -7; hero.dir = -1; hero.anim += 0.2; }
    else { hero.vx *= 0.85; }
    if(keys['Space'] && hero.grounded) { hero.vy = -18; hero.grounded = false; SFX.play(200, 'triangle', 0.2); }
    
    // Attack Controls
    if(keys['KeyZ'] && hero.cd === 0) fire('light');
    if(keys['KeyX'] && hero.cd === 0) fire('heavy');
    if(keys['KeyC'] && hero.cd === 0) fire('wide');

    hero.x += hero.vx; hero.y += hero.vy; hero.vy += 0.8;
    if(hero.y + hero.h > groundY) { hero.y = groundY - hero.h; hero.vy = 0; hero.grounded = true; }
    if(hero.x < 0) hero.x = 0;

    // Boss Activation
    if(state.time > 60 * BOSS_TIME && !state.bossActive) {
        state.bossActive = true; boss = new TitanBoss();
        ASSETS.boss.src = BOSS_IMAGES[state.stage - 1] || BOSS_IMAGES[0];
        document.getElementById('boss-hud').style.display = 'block';
        document.getElementById('boss-name').innerText = boss.name;
        SFX.play(80, 'sawtooth', 1.5, 0.3);
        // 🎵 Switch to boss music
        playMusic(MUSIC.boss);
    }

    if(!state.bossActive) {
        state.scroll += 6;
        if(Math.random() < 0.01) enemies.push(new Enemy(canvas.width));
        if(Math.random() < 0.007) hazards.push(new BrickWall(canvas.width, Math.random() > 0.5 ? 'wall' : 'spike'));
    } else {
        boss.update(); boss.draw();
    }

    // Process Entities
    enemies = enemies.filter(en => { en.draw(); return !en.update(); });
    projectiles = projectiles.filter(p => { p.draw(); return !p.update(); });
    bossAttacks = bossAttacks.filter(p => { p.draw(); return !p.update(); });
    particles = particles.filter(p => { p.draw(); p.update(); return p.life > 0; });
    hazards = hazards.filter(h => { h.draw(); return !h.update(6); });

    drawHero();
    updateUI();

    if(hero.hp <= 0) handleDeath();
    if(state.bossActive && state.bossHp <= 0) handleVictory();

    requestAnimationFrame(mainLoop);
}

function renderBackground(groundY) {
    const sky = ctx.createLinearGradient(0,0,0,canvas.height);
    if(state.isDay) { sky.addColorStop(0, '#87CEEB'); sky.addColorStop(1, '#E0F6FF'); }
    else { sky.addColorStop(0, '#050010'); sky.addColorStop(1, '#1A0033'); }
    ctx.fillStyle = sky; ctx.fillRect(0,0,canvas.width, canvas.height);

    // Sun/Moon
    ctx.shadowBlur = 30; ctx.shadowColor = state.isDay ? 'gold' : '#fff';
    ctx.fillStyle = state.isDay ? '#FFD700' : '#FFF';
    ctx.beginPath(); ctx.arc(canvas.width - 150, 100, 40, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;

    // Ground & Parallax Trees
    for(let i=0; i<10; i++) {
        let tx = (i * 450 - (state.scroll * 0.4)) % (canvas.width + 450);
        ctx.fillStyle = state.isDay ? '#8B4513' : '#111';
        ctx.fillRect(tx, groundY-100, 20, 100);
        ctx.fillStyle = state.isDay ? '#32CD32' : '#bc13fe';
        ctx.beginPath(); ctx.arc(tx+10, groundY-110, 55, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = state.isDay ? '#32CD32' : '#050010';
    ctx.fillRect(0, groundY, canvas.width, 120);
    if(!state.isDay) { ctx.strokeStyle = '#bc13fe'; ctx.lineWidth = 3; ctx.strokeRect(0, groundY, canvas.width, 2); }
}

function drawHero() {
    ctx.save();
    if(state.shake > 0) { ctx.translate(Math.random()*state.shake, Math.random()*state.shake); state.shake--; }
    ctx.translate(hero.x + 20, hero.y + 40);
    if(hero.dir === -1) ctx.scale(-1, 1);
    ctx.shadowBlur = 15; ctx.shadowColor = 'var(--cyan)';
    ctx.strokeStyle = 'var(--cyan)'; ctx.lineWidth = 3;
    const walk = hero.grounded ? Math.sin(hero.anim) * 15 : 10;
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(-walk, 40); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(walk, 40); ctx.stroke();
    ctx.fillStyle = "rgba(0, 242, 255, 0.2)";
    ctx.strokeRect(-12, -15, 24, 30); ctx.fillRect(-12, -15, 24, 30);
    ctx.beginPath(); ctx.arc(0, -32, 12, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillRect(4, -35, 8, 3);
    ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(15, 5); ctx.stroke();
    ctx.fillStyle = "#222"; ctx.fillRect(15, 0, 20, 8);
    ctx.restore();
}

function fire(type) {
    hero.cd = type === 'heavy' ? 40 : 15;
    SFX.play(type === 'heavy' ? 300 : 800, 'sawtooth', 0.1);
    projectiles.push(new Projectile(hero.x + 20, hero.y + 30, hero.dir * 15, type));
}

function updateUI() {
    document.getElementById('score').innerText = state.score.toString().padStart(5, '0');
    document.getElementById('player-hp-fill').style.width = hero.hp + '%';
    document.getElementById('boss-hp-fill').style.width = state.bossHp + '%';
    document.getElementById('phase').innerText = state.isDay ? 'DAY' : 'NIGHT';
    document.getElementById('stage-num').innerText = state.stage;
    const rem = Math.max(0, BOSS_TIME - Math.floor(state.time/60));
    document.getElementById('timer').innerText = `${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')}`;
}

function handleDeath() {
    state.lives--; hero.hp = 100;
    const h = document.querySelectorAll('.heart');
    if(h[state.lives]) h[state.lives].classList.add('lost');
     if(state.lives <= 0) {
        // Pause the game
        state.active = false;
        // Instead of reloading immediately, show Save Me option
        document.getElementById('screen-msg').style.display = 'flex';
        document.getElementById('msg-text').innerText = "You Died!";
        document.getElementById('save-btn').style.display = "inline-block"; // show Save Me button
        document.getElementById('next-btn').style.display = "none"; // hide Next Mission
    }
}

function saveMe() {
    // Open your YouTube video in a new tab
    const win = window.open("https://www.youtube.com/watch?v=z9ZzUcUz7_Q", "_blank");
    // Pause game while waiting
    state.active = false;
    // After 30 seconds, allow the player to continue
    setTimeout(() => {
        // Optional: try to close the video tab (may be blocked by browser)
        if (win) win.close();

        // Reset player state so they can play again
        state.active = true;
        hero.hp = 100;
        state.lives = 1; // give them one life back
        document.getElementById('screen-msg').style.display = 'none';
        mainLoop();
    }, 30000); // 30 seconds
}

function handleVictory() {
    state.active = false;
    SFX.play(800, 'sine', 1.0);
    document.getElementById('screen-msg').style.display = 'flex';
    // 🎵 Stop music when boss dies
    stopMusic();
    if(state.stage >= 10) {
        document.getElementById('msg-text').innerText =
      "You killed all the bosses.\nYou saved your village.\nYour villagers will remember you and feel proud.\nVictory!\nThanks for playing.\nCredits: Yousha, ChatGPT, Gemini";
    document.getElementById('next-btn').style.display = "none";
  }
}

function nextStage() {
    localStorage.setItem('neonStage', state.stage + 1);
    localStorage.setItem('neonScore', state.score);
    // 🎵 Play next stage track
    playMusic(MUSIC.stageTracks[state.stage]);
    location.reload();
}

// Keyboard listeners
window.addEventListener('keydown', e => {
    keys[e.code] = true;

    // 🎵 Start stage music on first key press if not already playing
    if (!currentTrack) {
        playMusic(MUSIC.stageTracks[state.stage - 1]);
    }
});


window.addEventListener('keyup', e => keys[e.code] = false);

// --- Touch Controls (Swipe) ---
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('touchstart', e => {
    const touch = e.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
});

canvas.addEventListener('touchend', e => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    // Detect swipe direction
    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal swipe
        if (dx > 50) {
            keys['ArrowRight'] = true; // swipe right
        } else if (dx < -50) {
            keys['ArrowLeft'] = true; // swipe left
        }
    } else {
        // Vertical swipe
        if (dy < -50) {
            keys['Space'] = true; // swipe up = jump
        }
    }

    // Clear keys shortly after so action registers
    setTimeout(() => {
        keys['ArrowLeft'] = false;
        keys['ArrowRight'] = false;
        keys['Space'] = false;
    }, 200); // 200ms gives the loop time to process
});

// --- Touch Controls (Tap for Attack) ---
// Place this directly BELOW your swipe controls
canvas.addEventListener('touchstart', e => {
    // Single tap anywhere triggers a light attack
    if (hero.cd === 0) {
        fire('wide'); // you can change to 'heavy' or 'wide'
    }
});

// Init Hearts
const lb = document.getElementById('lives-box');
for(let i=0; i<3; i++) lb.innerHTML += '<div class="heart"></div>';
mainLoop();