import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { config } from '../utils/config';
import bcrypt from 'bcrypt';

let db: Database;

export async function connectDatabase() {
  db = await open({
    filename: config.SQLITE_DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      username TEXT,
      homeScore INTEGER,
      awayScore INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS winnersPredictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      username TEXT,
      homeScore INTEGER,
      awayScore INTEGER,
      timestamp DATETIME 
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    visible INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS dedsafio_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    visible INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        isAdmin INTEGER DEFAULT 0
    )
  `);

  

  await db.exec(`
    CREATE TABLE IF NOT EXISTS dedsafio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        isDead INTEGER DEFAULT 0,
        hasSoul INTEGER DEFAULT 1
    )`
  );

  await db.exec(`
    CREATE TABLE IF NOT EXISTS dedsafio_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_index INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    visible INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const adminUser = await db.get('SELECT * FROM users WHERE username = ?', ['admin']);

    if (!adminUser) {
        console.log("No admin user found. Creating default admin user...");

        // Crear un usuario administrador por defecto
        const hashedPassword = await bcrypt.hash("C35,vHU0=Mu.4xGa9I{", 10);
        await db.run(
            'INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)',
            ['admin', hashedPassword, 1]
        );

        console.log("Default admin user created successfully.");
    } else {
        console.log("Admin user already exists.");
    }
}

export async function savePrediction(
  userId: string,
  username: string,
  homeScore: number,
  awayScore: number
) {
  await db.run(
    'INSERT INTO predictions (userId, username, homeScore, awayScore) VALUES (?, ?, ?, ?)',
    [userId, username, homeScore, awayScore]
  );
}

export async function editPrediction(
  id: number,
  homeScore: number,
  awayScore: number
) {
  await db.run(
    'UPDATE predictions SET homeScore = ?, awayScore = ?, timestamp = CURRENT_TIMESTAMP WHERE id = ?',
    [homeScore, awayScore, id]
  );
}

export async function getTopPredictions(limit: number = 5) {
  return db.all(`
    SELECT homeScore, awayScore, COUNT(*) as count
    FROM predictions
    GROUP BY homeScore, awayScore
    ORDER BY count DESC
    LIMIT ?
  `, [limit]);
}

export async function clearPredictions() {
  await db.run('DELETE FROM predictions');
}

export async function getWinners(homeScore: number, awayScore: number) {
  return db.all(`
    SELECT userId, username, homeScore, awayScore, timestamp
    FROM predictions
    WHERE homeScore = ? AND awayScore = ?
  `, [homeScore, awayScore]);
}

export async function saveWinnersPrediction(
  userId: string,
  username: string,
  homeScore: number,
  awayScore: number,
  timestamp: string
) {
  await db.run(
    'INSERT INTO winnersPredictions (userId, username, homeScore, awayScore, timestamp) VALUES (?, ?, ?, ?, ?)',
    [userId, username, homeScore, awayScore, timestamp]
  );
}

//dedsafio
export async function getDedsafio() {
  return db.all('SELECT * FROM dedsafio');
}

export async function saveDedsafio(values: {username: string, isDead: number, hasSoul: number}[]) {
  await db.run('DELETE FROM dedsafio');

  for (let i = 0; i < values.length; i++) {
    await db.run(
      'INSERT INTO dedsafio (username, isDead, hasSoul) VALUES (?, ?, ?)',
      [values[i].username, values[i].isDead, values[i].hasSoul]
    );
  }
}

export async function getWinnersPrediction() {
  return db.all('SELECT * FROM winnersPredictions order by timestamp desc');
}

export async function clearWinnersPredictions() {
  await db.run('DELETE FROM winnersPredictions');
}

export async function getPredictionCount() {
  return db.get('SELECT COUNT(*) as count FROM predictions');
}

export async function getPredictionByUserId(userId: string) {
  return db.get('SELECT * FROM predictions WHERE userId = ?', [userId]);
}

export async function closeDatabase() {
  await db.close();
}

export async function getPositionsAndVisibilityQueensleague() {
  return db.all('SELECT position_index, x, y, visible FROM prediction_positions ORDER BY position_index ASC');
}

export async function getPositionsAndVisibilityDedsafio() {
  return db.all('SELECT position_index, x, y, visible FROM dedsafio_positions ORDER BY position_index ASC');
}

export async function savePositionsAndVisibilityQueensleague(positions: { x: number, y: number, visible: boolean }[]) {
  await db.run('DELETE FROM prediction_positions');

  for (let i = 0; i < positions.length; i++) {
    await db.run(
      'INSERT INTO prediction_positions (position_index, x, y, visible) VALUES (?, ?, ?, ?)',
      [i, positions[i].x, positions[i].y, positions[i].visible]
    );
  }
}

export async function savePositionsAndVisibilityDedsafio(positions: { x: number, y: number }[]) {
  await db.run('DELETE FROM dedsafio_positions');

  for (let i = 0; i < positions.length; i++) {
    await db.run(
      'INSERT INTO dedsafio_positions (position_index, x, y) VALUES (?, ?, ?)',
      [i, positions[i].x, positions[i].y]
    );
  }
}

export async function getUser(username: string) {
  return db.get('SELECT * FROM users WHERE username = ?', [username]);
}