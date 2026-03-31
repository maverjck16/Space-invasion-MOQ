import type { GameSnapshot } from "../moq/publisher";
import spaceshipImgSrc from "../image/spaceship.png";
import invaderImgSrc from "../image/invader.png";

type LocalGameOptions = {
  canvas: HTMLCanvasElement;
  onSnapshot: (snapshot: GameSnapshot) => void;
  onScoreChange?: (score: number) => void;
};

type Vec2 = {
  x: number;
  y: number;
};

type RestartButton = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type KeysState = {
  a: { pressed: boolean };
  d: { pressed: boolean };
  w: { pressed: boolean };
  s: { pressed: boolean };
  space: { pressed: boolean };
};

type GameFlags = {
  over: boolean;
  active: boolean;
};

type ProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
};

type InvaderProjectileLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

type ParticleLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;
};

type InvaderLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
};

type GridLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  invaders: Invader[];
};

type AsteroidLike = {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  health: number;
  maxHealth: number;
  points: number[];
};

let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function createLocalGame(
  canvas: HTMLCanvasElement,
  onSnapshot: (snapshot: GameSnapshot) => void,
  onScoreChange?: (score: number) => void,
): () => void {
  const game = new LocalGameEngine({
    canvas,
    onSnapshot,
    onScoreChange,
  });

  game.start();
  return () => game.destroy();
}

class Player {
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  image: HTMLImageElement;
  loaded: boolean;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
  ) {
    this.width = 60;
    this.height = 60;
    this.position = {
      x: this.canvas.width / 2 - this.width / 2,
      y: this.canvas.height - this.height - 30,
    };
    this.velocity = { x: 0, y: 0 };
    this.rotation = 0;
    this.opacity = 1;

    this.image = new Image();
    this.image.src = spaceshipImgSrc;
    this.loaded = false;

    this.image.onload = () => {
      this.loaded = true;

      const scale = 0.18;
      this.width = this.image.width * scale;
      this.height = this.image.height * scale;
      this.position.x = this.canvas.width / 2 - this.width / 2;
      this.position.y = this.canvas.height - this.height - 30;
    };
  }

  draw(): void {
    const { ctx } = this;
    const { x, y } = this.position;

    if (!this.loaded) return;

    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(x + this.width / 2, y + this.height / 2);
    ctx.rotate(this.rotation);
    ctx.translate(-(x + this.width / 2), -(y + this.height / 2));

    ctx.drawImage(this.image, x, y, this.width, this.height);

    ctx.restore();
  }

  update(): void {
    this.draw();

    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    if (this.position.x < 0) this.position.x = 0;
    if (this.position.x + this.width > this.canvas.width) {
      this.position.x = this.canvas.width - this.width;
    }

    if (this.position.y < 0) this.position.y = 0;
    if (this.position.y + this.height > this.canvas.height) {
      this.position.y = this.canvas.height - this.height;
    }
  }
}

class Projectile {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2; velocity: Vec2 },
  ) {
    this.id = nextId("proj");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.radius = 4;
  }

  draw(): void {
    this.ctx.beginPath();
    this.ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = "#ff4d4d";
    this.ctx.fill();
    this.ctx.closePath();
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
  }
}

class Particle {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  color: string;
  opacity: number;
  fades: boolean;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: {
      position: Vec2;
      velocity: Vec2;
      radius: number;
      color: string;
      fades?: boolean;
    },
  ) {
    this.id = nextId("particle");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.radius = args.radius;
    this.color = args.color;
    this.opacity = 1;
    this.fades = args.fades ?? false;
  }

  draw(): void {
    this.ctx.save();
    this.ctx.globalAlpha = this.opacity;
    this.ctx.beginPath();
    this.ctx.arc(this.position.x, this.position.y, this.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = this.color;
    this.ctx.fill();
    this.ctx.closePath();
    this.ctx.restore();
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    if (this.fades) {
      this.opacity -= 0.02;
    }
  }
}

class InvaderProjectile {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2; velocity: Vec2 },
  ) {
    this.id = nextId("invproj");
    this.position = { ...args.position };
    this.velocity = { ...args.velocity };
    this.width = 3;
    this.height = 10;
  }

  draw(): void {
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(this.position.x, this.position.y, this.width, this.height);
  }

  update(): void {
    this.draw();
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
  }
}

class Invader {
  id: string;
  position: Vec2;
  velocity: Vec2;
  width: number;
  height: number;
  image: HTMLImageElement;
  loaded: boolean;

  constructor(
    private ctx: CanvasRenderingContext2D,
    args: { position: Vec2 },
  ) {
    this.id = nextId("invader");
    this.position = { ...args.position };
    this.velocity = { x: 0, y: 0 };
    this.width = 30;
    this.height = 30;

    this.image = new Image();
    this.image.src = invaderImgSrc;
    this.loaded = false;

    this.image.onload = () => {
      this.loaded = true;
      const scale = 1;
      this.width = this.image.width * scale;
      this.height = this.image.height * scale;
    };
  }

  draw(): void {
    if (!this.loaded) return;
    this.ctx.drawImage(
      this.image,
      this.position.x,
      this.position.y,
      this.width,
      this.height,
    );
  }

  update(args: { velocity: Vec2 }): void {
    this.draw();
    this.position.x += args.velocity.x;
    this.position.y += args.velocity.y;
  }

  shoot(invaderProjectiles: InvaderProjectile[]): void {
    invaderProjectiles.push(
      new InvaderProjectile(this.ctx, {
        position: {
          x: this.position.x + this.width / 2,
          y: this.position.y + this.height,
        },
        velocity: {
          x: 0,
          y: 7,
        },
      }),
    );
  }
}

class Grid {
  id: string;
  position: Vec2;
  velocity: Vec2;
  invaders: Invader[];
  width: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
  ) {
    this.id = nextId("grid");
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 3, y: 0 };
    this.invaders = [];

    const columns = Math.floor(Math.random() * 10 + 5);
    const rows = Math.floor(Math.random() * 5 + 2);

    this.width = columns * 30;

    for (let x = 0; x < columns; x++) {
      for (let y = 0; y < rows; y++) {
        this.invaders.push(
          new Invader(this.ctx, {
            position: {
              x: x * 30,
              y: y * 30,
            },
          }),
        );
      }
    }
  }

  update(): void {
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;

    this.velocity.y = 0;

    if (
      this.position.x + this.width >= this.canvas.width ||
      this.position.x <= 0
    ) {
      this.velocity.x = -this.velocity.x;
      this.velocity.y = 30;
    }
  }
}

class Asteroid {
  id: string;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  rotation: number;
  rotationSpeed: number;
  health: number;
  maxHealth: number;
  points: number[];

  constructor(
    private ctx: CanvasRenderingContext2D,
    private canvas: HTMLCanvasElement,
    args: { target: Vec2 },
  ) {
    this.id = nextId("asteroid");

    this.radius = Math.random() * 24 + 18;

    if (this.radius < 26) this.maxHealth = 2;
    else if (this.radius < 34) this.maxHealth = 3;
    else this.maxHealth = 4;

    this.health = this.maxHealth;
    this.rotation = 0;
    this.rotationSpeed = (Math.random() - 0.5) * 0.05;

    const spawnSide = Math.floor(Math.random() * 4);
    let startX = 0;
    let startY = 0;

    if (spawnSide === 0) {
      startX = Math.random() * this.canvas.width;
      startY = -this.radius - 20;
    } else if (spawnSide === 1) {
      startX = this.canvas.width + this.radius + 20;
      startY = Math.random() * this.canvas.height;
    } else if (spawnSide === 2) {
      startX = Math.random() * this.canvas.width;
      startY = this.canvas.height + this.radius + 20;
    } else {
      startX = -this.radius - 20;
      startY = Math.random() * this.canvas.height;
    }

    this.position = { x: startX, y: startY };

    const angle = Math.atan2(args.target.y - startY, args.target.x - startX);
    const speed = Math.random() * 1.1 + 1.2;

    this.velocity = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };

    const pointsCount = Math.floor(Math.random() * 4) + 8;
    this.points = [];

    for (let i = 0; i < pointsCount; i++) {
      const variation = this.radius * (0.72 + Math.random() * 0.38);
      const angleStep = (Math.PI * 2 * i) / pointsCount;
      this.points.push(Math.cos(angleStep), Math.sin(angleStep), variation);
    }
  }

  private drawCracks(): void {
    const damageRatio = 1 - this.health / this.maxHealth;
    if (damageRatio <= 0) return;

    this.ctx.save();
    this.ctx.strokeStyle = `rgba(80, 80, 80, ${0.55 + damageRatio * 0.3})`;
    this.ctx.lineWidth = 1.2;

    for (let i = 0; i < Math.ceil(damageRatio * 4); i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, 0);
      this.ctx.lineTo(
        (Math.random() - 0.5) * this.radius * 1.2,
        (Math.random() - 0.5) * this.radius * 1.2,
      );
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  draw(): void {
    this.ctx.save();
    this.ctx.translate(this.position.x, this.position.y);
    this.ctx.rotate(this.rotation);

    this.ctx.beginPath();

    if (this.points.length >= 3) {
      const firstRadius = this.points[2];
      this.ctx.moveTo(this.points[0] * firstRadius, this.points[1] * firstRadius);

      for (let i = 3; i < this.points.length; i += 3) {
        const nx = this.points[i];
        const ny = this.points[i + 1];
        const nr = this.points[i + 2];
        this.ctx.lineTo(nx * nr, ny * nr);
      }

      this.ctx.closePath();
    } else {
      this.ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    }

    this.ctx.fillStyle = "#9f9f9f";
    this.ctx.strokeStyle = "#d0d0d0";
    this.ctx.lineWidth = 2;
    this.ctx.fill();
    this.ctx.stroke();

    this.drawCracks();
    this.ctx.restore();

    this.drawHealthBar();
  }

  private drawHealthBar(): void {
    const width = this.radius * 1.8;
    const height = 5;
    const left = this.position.x - width / 2;
    const top = this.position.y - this.radius - 14;

    this.ctx.fillStyle = "rgba(255,255,255,0.18)";
    this.ctx.fillRect(left, top, width, height);

    this.ctx.fillStyle = "#00ffff";
    this.ctx.fillRect(left, top, width * (this.health / this.maxHealth), height);
  }

  update(): void {
    this.rotation += this.rotationSpeed;
    this.position.x += this.velocity.x;
    this.position.y += this.velocity.y;
    this.draw();
  }
}

class LocalGameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onSnapshot: (snapshot: GameSnapshot) => void;
  private onScoreChange?: (score: number) => void;

  private player: Player;
  private projectiles: Projectile[] = [];
  private grids: Grid[] = [];
  private invaderProjectiles: InvaderProjectile[] = [];
  private particles: Particle[] = [];
  private asteroids: Asteroid[] = [];

  private keys: KeysState = {
    a: { pressed: false },
    d: { pressed: false },
    w: { pressed: false },
    s: { pressed: false },
    space: { pressed: false },
  };

  private restartButton: RestartButton;
  private frames = 0;
  private randomInterval = Math.floor(Math.random() * 500 + 500);
  private asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);
  private game: GameFlags = { over: false, active: true };
  private score = 0;
  private animationId: number | null = null;
  private destroyed = false;
  private scoreEl: HTMLElement | null = null;

  constructor(options: LocalGameOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponibile");

    this.ctx = ctx;
    this.onSnapshot = options.onSnapshot;
    this.onScoreChange = options.onScoreChange;

    this.player = new Player(this.ctx, this.canvas);
    this.restartButton = {
      x: this.canvas.width / 2 - 160,
      y: this.canvas.height / 2 + 100,
      width: 320,
      height: 70,
    };

    this.scoreEl = document.querySelector("#localScoreEl");
    this.updateScoreUI();
    this.createBackgroundStars();

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.animate = this.animate.bind(this);
  }

  start(): void {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.canvas.addEventListener("click", this.handleClick);
    this.animate();
  }

  destroy(): void {
    this.destroyed = true;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("click", this.handleClick);
  }

  private updateScoreUI(): void {
    if (this.scoreEl) {
      this.scoreEl.textContent = String(this.score);
    }
    this.onScoreChange?.(this.score);
  }

  private createBackgroundStars(): void {
    for (let i = 0; i < 100; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: Math.random() * this.canvas.width,
            y: Math.random() * this.canvas.height,
          },
          velocity: {
            x: 0,
            y: 0.3,
          },
          radius: Math.random() * 2,
          color: "white",
        }),
      );
    }
  }

  private createParticles(args: {
    object: { position: Vec2; width: number; height: number };
    color: string;
    fades: boolean;
    count?: number;
  }): void {
    const count = args.count ?? 15;

    for (let i = 0; i < count; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: args.object.position.x + args.object.width / 2,
            y: args.object.position.y + args.object.height / 2,
          },
          velocity: {
            x: (Math.random() - 0.5) * 3,
            y: (Math.random() - 0.5) * 3,
          },
          radius: Math.random() * 3 + 1,
          color: args.color,
          fades: args.fades,
        }),
      );
    }
  }

  private createAsteroidHitParticles(projectile: Projectile): void {
    for (let i = 0; i < 10; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: projectile.position.x,
            y: projectile.position.y,
          },
          velocity: {
            x: (Math.random() - 0.5) * 2.5,
            y: (Math.random() - 0.5) * 2.5,
          },
          radius: Math.random() * 2 + 1,
          color: "#cfcfcf",
          fades: true,
        }),
      );
    }
  }

  private createAsteroidExplosion(asteroid: Asteroid): void {
    for (let i = 0; i < 24; i++) {
      this.particles.push(
        new Particle(this.ctx, {
          position: {
            x: asteroid.position.x,
            y: asteroid.position.y,
          },
          velocity: {
            x: (Math.random() - 0.5) * 4.5,
            y: (Math.random() - 0.5) * 4.5,
          },
          radius: Math.random() * 2.5 + 1,
          color: "#d8d8d8",
          fades: true,
        }),
      );
    }
  }

  private asteroidHitsPlayer(asteroid: Asteroid, player: Player): boolean {
    const playerCenterX = player.position.x + player.width / 2;
    const playerCenterY = player.position.y + player.height / 2;

    const distX = asteroid.position.x - playerCenterX;
    const distY = asteroid.position.y - playerCenterY;
    const distance = Math.hypot(distX, distY);

    const playerRadiusApprox = Math.max(player.width, player.height) / 2.5;

    return distance < asteroid.radius + playerRadiusApprox;
  }

  private projectileHitsAsteroid(
    projectile: Projectile,
    asteroid: Asteroid,
  ): boolean {
    const distX = projectile.position.x - asteroid.position.x;
    const distY = projectile.position.y - asteroid.position.y;
    const distance = Math.hypot(distX, distY);

    return distance < projectile.radius + asteroid.radius;
  }

  private playerDeath(): void {
    this.player.opacity = 0;
    this.game.over = true;

    this.createParticles({
      object: this.player,
      color: "#ffffff",
      fades: true,
      count: 30,
    });

    window.setTimeout(() => {
      if (!this.destroyed) {
        this.game.active = false;
      }
    }, 2000);
  }

  private drawGameOver(): void {
    this.ctx.save();

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";

    this.ctx.shadowColor = "#ff00ff";
    this.ctx.shadowBlur = 25;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 80px Impact, sans-serif";
    this.ctx.fillText("GAME OVER", this.canvas.width / 2, this.canvas.height / 2 - 50);

    this.ctx.shadowColor = "#00ffff";
    this.ctx.shadowBlur = 18;
    this.ctx.fillStyle = "#00ffff";
    this.ctx.font = '18px "Press Start 2P", monospace';
    this.ctx.fillText(
      `SCORE: ${this.score}`,
      this.canvas.width / 2,
      this.canvas.height / 2 + 24,
    );

    this.ctx.fillStyle = "#111111";
    this.ctx.strokeStyle = "#ffffff";
    this.ctx.lineWidth = 3;
    this.ctx.fillRect(
      this.restartButton.x,
      this.restartButton.y,
      this.restartButton.width,
      this.restartButton.height,
    );
    this.ctx.strokeRect(
      this.restartButton.x,
      this.restartButton.y,
      this.restartButton.width,
      this.restartButton.height,
    );

    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = '20px "Press Start 2P", monospace';
    this.ctx.fillText(
      "RESTART",
      this.restartButton.x + this.restartButton.width / 2,
      this.restartButton.y + this.restartButton.height / 2 + 2,
    );

    this.ctx.restore();
  }

  private restartGame(): void {
  this.player = new Player(this.ctx, this.canvas);
  this.player.opacity = 1;

  this.projectiles = [];
  this.grids = [];
  this.invaderProjectiles = [];
  this.particles = [];
  this.asteroids = [];

  this.keys = {
    a: { pressed: false },
    d: { pressed: false },
    w: { pressed: false },
    s: { pressed: false },
    space: { pressed: false },
  };

  this.createBackgroundStars();

  this.score = 0;
  this.updateScoreUI();

  this.frames = 0;
  this.randomInterval = Math.floor(Math.random() * 500 + 500);
  this.asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);

  this.game = {
    over: false,
    active: true,
  };

  this.emitSnapshot();
}

  private emitSnapshot(): void {
    const snapshot: GameSnapshot = {
      tick: this.frames,
      player: {
        x: this.player.position.x,
        y: this.player.position.y,
        width: this.player.width,
        height: this.player.height,
        vx: this.player.velocity.x,
        vy: this.player.velocity.y,
        rotation: this.player.rotation,
        opacity: this.player.opacity,
      },
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        radius: p.radius,
      })),
      invaderProjectiles: this.invaderProjectiles.map((p) => ({
        id: p.id,
        x: p.position.x,
        y: p.position.y,
        vx: p.velocity.x,
        vy: p.velocity.y,
        width: p.width,
        height: p.height,
      })),
      grids: this.grids.map((grid) => ({
        id: grid.id,
        x: grid.position.x,
        y: grid.position.y,
        vx: grid.velocity.x,
        vy: grid.velocity.y,
        width: grid.width,
        invaders: grid.invaders.map((invader) => ({
          id: invader.id,
          x: invader.position.x,
          y: invader.position.y,
          width: invader.width,
          height: invader.height,
        })),
      })),
      particles: this.particles.map((particle) => ({
        id: particle.id,
        x: particle.position.x,
        y: particle.position.y,
        vx: particle.velocity.x,
        vy: particle.velocity.y,
        radius: particle.radius,
        color: particle.color,
        opacity: particle.opacity,
        fades: particle.fades,
      })),
      asteroids: this.asteroids.map((asteroid) => ({
        id: asteroid.id,
        x: asteroid.position.x,
        y: asteroid.position.y,
        vx: asteroid.velocity.x,
        vy: asteroid.velocity.y,
        radius: asteroid.radius,
        rotation: asteroid.rotation,
        health: asteroid.health,
        maxHealth: asteroid.maxHealth,
        points: asteroid.points,
      })),
      score: this.score,
      gameOver: this.game.over,
      gameActive: this.game.active,
    };

    this.onSnapshot(snapshot);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.game.over) return;

    switch (event.key) {
      case "a":
      case "A":
        this.keys.a.pressed = true;
        break;
      case "d":
      case "D":
        this.keys.d.pressed = true;
        break;
      case "w":
      case "W":
        this.keys.w.pressed = true;
        break;
      case "s":
      case "S":
        this.keys.s.pressed = true;
        break;
      case " ":
        if (!this.keys.space.pressed) {
          this.keys.space.pressed = true;
          this.projectiles.push(
            new Projectile(this.ctx, {
              position: {
                x: this.player.position.x + this.player.width / 2,
                y: this.player.position.y - 5,
              },
              velocity: {
                x: 0,
                y: -10,
              },
            }),
          );
        }
        break;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    switch (event.key) {
      case "a":
      case "A":
        this.keys.a.pressed = false;
        break;
      case "d":
      case "D":
        this.keys.d.pressed = false;
        break;
      case "w":
      case "W":
        this.keys.w.pressed = false;
        break;
      case "s":
      case "S":
        this.keys.s.pressed = false;
        break;
      case " ":
        this.keys.space.pressed = false;
        break;
    }
  }

  private handleClick(event: MouseEvent): void {
  if (this.game.active || !this.game.over) return;

  const rect = this.canvas.getBoundingClientRect();

  const scaleX = this.canvas.width / rect.width;
  const scaleY = this.canvas.height / rect.height;

  const mouse = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };

  if (
    mouse.x >= this.restartButton.x &&
    mouse.x <= this.restartButton.x + this.restartButton.width &&
    mouse.y >= this.restartButton.y &&
    mouse.y <= this.restartButton.y + this.restartButton.height
  ) {
    this.restartGame();
  }
}

  private animate(): void {
    if (this.destroyed) return;

    this.animationId = requestAnimationFrame(this.animate);

    this.ctx.fillStyle = "black";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.game.active) {
      this.drawGameOver();
      this.emitSnapshot();
      return;
    }

    this.player.update();

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];

      if (
        !particle.fades &&
        particle.position.y - particle.radius >= this.canvas.height
      ) {
        particle.position.x = Math.random() * this.canvas.width;
        particle.position.y = -particle.radius;
      }

      if (particle.opacity <= 0) {
        this.particles.splice(i, 1);
      } else {
        particle.update();
      }
    }

    for (let asteroidIndex = this.asteroids.length - 1; asteroidIndex >= 0; asteroidIndex--) {
      const asteroid = this.asteroids[asteroidIndex];
      asteroid.update();

      if (
        asteroid.position.y - asteroid.radius > this.canvas.height + 60 ||
        asteroid.position.y + asteroid.radius < -60 ||
        asteroid.position.x - asteroid.radius > this.canvas.width + 60 ||
        asteroid.position.x + asteroid.radius < -60
      ) {
        this.asteroids.splice(asteroidIndex, 1);
        continue;
      }

      if (
        !this.game.over &&
        this.player.opacity > 0 &&
        this.asteroidHitsPlayer(asteroid, this.player)
      ) {
        this.asteroids.splice(asteroidIndex, 1);
        this.playerDeath();
        continue;
      }

      for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex--) {
        const projectile = this.projectiles[projectileIndex];

        if (this.projectileHitsAsteroid(projectile, asteroid)) {
          this.projectiles.splice(projectileIndex, 1);
          asteroid.health -= 1;

          this.createAsteroidHitParticles(projectile);

          if (asteroid.health <= 0) {
            this.createAsteroidExplosion(asteroid);
            this.score += asteroid.maxHealth * 70;
            this.updateScoreUI();
            this.asteroids.splice(asteroidIndex, 1);
          }

          break;
        }
      }
    }

    for (let i = this.invaderProjectiles.length - 1; i >= 0; i--) {
      const invaderProjectile = this.invaderProjectiles[i];

      if (invaderProjectile.position.y > this.canvas.height) {
        this.invaderProjectiles.splice(i, 1);
        continue;
      }

      invaderProjectile.update();

      if (
        !this.game.over &&
        invaderProjectile.position.y + invaderProjectile.height >= this.player.position.y &&
        invaderProjectile.position.x + invaderProjectile.width >= this.player.position.x &&
        invaderProjectile.position.x <= this.player.position.x + this.player.width
      ) {
        this.invaderProjectiles.splice(i, 1);
        this.playerDeath();
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];

      if (projectile.position.y + projectile.radius <= 0) {
        this.projectiles.splice(i, 1);
      } else {
        projectile.update();
      }
    }

    for (let gridIndex = this.grids.length - 1; gridIndex >= 0; gridIndex--) {
      const grid = this.grids[gridIndex];
      grid.update();

      if (this.frames % 45 === 0 && grid.invaders.length > 0) {
        grid.invaders[
          Math.floor(Math.random() * grid.invaders.length)
        ]?.shoot(this.invaderProjectiles);
      }

      for (let i = grid.invaders.length - 1; i >= 0; i--) {
        const invader = grid.invaders[i];

        invader.update({ velocity: grid.velocity });

        if (
          !this.game.over &&
          this.player.opacity > 0 &&
          this.player.position.x < invader.position.x + invader.width &&
          this.player.position.x + this.player.width > invader.position.x &&
          this.player.position.y < invader.position.y + invader.height &&
          this.player.position.y + this.player.height > invader.position.y
        ) {
          grid.invaders.splice(i, 1);
          this.playerDeath();

          this.createParticles({
            object: invader,
            color: "#d8d8ff",
            fades: true,
            count: 15,
          });

          continue;
        }

        for (let j = this.projectiles.length - 1; j >= 0; j--) {
          const projectile = this.projectiles[j];

          if (
            projectile.position.y - projectile.radius <= invader.position.y + invader.height &&
            projectile.position.x + projectile.radius >= invader.position.x &&
            projectile.position.x - projectile.radius <= invader.position.x + invader.width &&
            projectile.position.y + projectile.radius >= invader.position.y
          ) {
            setTimeout(() => {
              const invaderFound = grid.invaders.find((candidate) => candidate === invader);
              const projectileFound = this.projectiles.find((candidate) => candidate === projectile);

              if (invaderFound && projectileFound) {
                this.score += 100;
                this.updateScoreUI();

                this.createParticles({
                  object: invader,
                  color: "#baa0de",
                  fades: true,
                  count: 15,
                });

                grid.invaders.splice(i, 1);
                this.projectiles.splice(j, 1);

                if (grid.invaders.length > 0) {
                  const firstInvader = grid.invaders[0];
                  const lastInvader = grid.invaders[grid.invaders.length - 1];

                  grid.width =
                    lastInvader.position.x - firstInvader.position.x + lastInvader.width;
                  grid.position.x = firstInvader.position.x;
                } else {
                  this.grids.splice(gridIndex, 1);
                }
              }
            }, 0);
          }
        }
      }
    }

    this.player.velocity.x = 0;
    this.player.velocity.y = 0;

    if (this.keys.a.pressed) {
      this.player.velocity.x = -7;
      this.player.rotation = -0.15;
    } else if (this.keys.d.pressed) {
      this.player.velocity.x = 7;
      this.player.rotation = 0.15;
    } else {
      this.player.rotation = 0;
    }

    if (this.keys.w.pressed) {
      this.player.velocity.y = -3;
    }

    if (this.keys.s.pressed) {
      this.player.velocity.y = 3;
    }

    if (this.frames % this.randomInterval === 0) {
      this.grids.push(new Grid(this.ctx, this.canvas));
      this.randomInterval = Math.floor(Math.random() * 500 + 500);
      this.frames = 0;
    }

    if (this.frames % this.asteroidSpawnInterval === 0) {
      this.asteroids.push(
        new Asteroid(this.ctx, this.canvas, {
          target: {
            x: this.player.position.x + this.player.width / 2,
            y: this.player.position.y + this.player.height / 2,
          },
        }),
      );
      this.asteroidSpawnInterval = Math.floor(Math.random() * 260 + 360);
    }

    this.frames += 1;
    this.emitSnapshot();
  }
}