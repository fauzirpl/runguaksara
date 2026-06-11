import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';

const JSON_DB_FILE = 'db.json';

let dbType = 'mysql';
let mysqlPool = null;
let jsonDb = {
  sessions: [],
  participants: [],
  transcripts: [],
  minutes: [],
  action_items: [],
  users: []
};

// Initialize Database
export function initDatabase() {
  return new Promise(async (resolve) => {
    const host = process.env.DB_HOST || '';
    const user = process.env.DB_USER || '';
    const database = process.env.DB_NAME || '';

    // If host or user is not configured, fallback to JSON database immediately
    if (!host || !user || !database) {
      console.warn('MySQL configuration (DB_HOST, DB_USER, or DB_NAME) missing in environment, falling back to JSON database.');
      useJsonFallback(resolve);
      return;
    }

    try {
      mysqlPool = mysql.createPool({
        host: host,
        port: parseInt(process.env.DB_PORT || '3306'),
        user: user,
        password: process.env.DB_PASSWORD || '',
        database: database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });

      // Test connection
      const connection = await mysqlPool.getConnection();
      console.log('MySQL database connection established successfully.');
      connection.release();

      await createTables(resolve);
    } catch (err) {
      if (err.code === 'ER_BAD_DB_ERROR') {
        console.log(`Database '${database}' does not exist. Attempting to create it...`);
        try {
          const tempConn = await mysql.createConnection({
            host: host,
            port: parseInt(process.env.DB_PORT || '3306'),
            user: user,
            password: process.env.DB_PASSWORD || ''
          });
          await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
          await tempConn.end();
          console.log(`Database '${database}' created successfully.`);

          // Re-establish the connection pool
          mysqlPool = mysql.createPool({
            host: host,
            port: parseInt(process.env.DB_PORT || '3306'),
            user: user,
            password: process.env.DB_PASSWORD || '',
            database: database,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
          });
          const connection = await mysqlPool.getConnection();
          console.log('MySQL database connection established successfully after creation.');
          connection.release();

          await createTables(resolve);
          return;
        } catch (createErr) {
          console.error(`Failed to automatically create database '${database}':`, createErr.message);
        }
      }
      console.warn('MySQL connection failed, falling back to JSON database:', err.message);
      useJsonFallback(resolve);
    }
  });
}

function useJsonFallback(resolve) {
  dbType = 'json';
  if (fs.existsSync(JSON_DB_FILE)) {
    try {
      jsonDb = JSON.parse(fs.readFileSync(JSON_DB_FILE, 'utf-8'));
    } catch (e) {
      console.error('Error reading JSON DB file, resetting database:', e.message);
    }
  } else {
    saveJsonDb();
  }
  console.log('Using JSON file-based database fallback.');
  resolve();
}

function saveJsonDb() {
  fs.writeFileSync(JSON_DB_FILE, JSON.stringify(jsonDb, null, 2), 'utf-8');
}

async function createTables(resolve) {
  try {
    // 1. Sessions Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS meeting_sessions (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255),
      title VARCHAR(255) NOT NULL,
      date VARCHAR(255),
      location VARCHAR(255),
      agenda TEXT,
      status VARCHAR(50) DEFAULT 'draft'
    )`);

    // 2. Participants Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS meeting_participants (
      id VARCHAR(255) PRIMARY KEY,
      session_id VARCHAR(255),
      name VARCHAR(255) NOT NULL,
      position VARCHAR(255),
      unit VARCHAR(255),
      FOREIGN KEY (session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE
    )`);

    // 3. Transcripts Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS transcripts (
      id VARCHAR(255) PRIMARY KEY,
      session_id VARCHAR(255),
      chunk_index INT,
      text TEXT,
      timestamp VARCHAR(255),
      speaker_label VARCHAR(255),
      FOREIGN KEY (session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE
    )`);

    // 4. Minutes Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS minutes (
      id VARCHAR(255) PRIMARY KEY,
      session_id VARCHAR(255),
      summary TEXT,
      content_json TEXT,
      notes_html TEXT,
      FOREIGN KEY (session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE
    )`);

    // 5. Action Items Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS action_items (
      id VARCHAR(255) PRIMARY KEY,
      minutes_id VARCHAR(255),
      description TEXT,
      pic VARCHAR(255),
      due_date VARCHAR(255),
      status VARCHAR(50) DEFAULT 'pending',
      FOREIGN KEY (minutes_id) REFERENCES minutes(id) ON DELETE CASCADE
    )`);

    // 6. Users Table
    await mysqlPool.query(`CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      fullname VARCHAR(255),
      email VARCHAR(255),
      role VARCHAR(50) DEFAULT 'user'
    )`);

    console.log('MySQL tables initialized successfully.');
    resolve();
  } catch (err) {
    console.error('Failed to initialize MySQL tables:', err.message);
    resolve();
  }
}

// Database Helpers
export const db = {
  // --- Sessions ---
  async getSessions(userId) {
    if (dbType === 'json') {
      return [...jsonDb.sessions].filter(s => s.user_id === userId).reverse();
    }
    const [rows] = await mysqlPool.query('SELECT * FROM meeting_sessions WHERE user_id = ? ORDER BY date DESC, id DESC', [userId]);
    return rows || [];
  },

  async getSession(id, userId) {
    if (dbType === 'json') {
      return jsonDb.sessions.find(s => s.id === id && s.user_id === userId) || null;
    }
    const [rows] = await mysqlPool.query('SELECT * FROM meeting_sessions WHERE id = ? AND user_id = ?', [id, userId]);
    return rows && rows.length > 0 ? rows[0] : null;
  },

  async createSession(session, userId) {
    session.user_id = userId;
    if (dbType === 'json') {
      const idx = jsonDb.sessions.findIndex(s => s.id === session.id);
      if (idx !== -1) {
        jsonDb.sessions[idx] = session;
      } else {
        jsonDb.sessions.push(session);
      }
      saveJsonDb();
      return session;
    }
    const { id, title, date, location, agenda, status } = session;
    await mysqlPool.query(
      'INSERT INTO meeting_sessions (id, user_id, title, date, location, agenda, status) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE title = VALUES(title), date = VALUES(date), location = VALUES(location), agenda = VALUES(agenda), status = VALUES(status)',
      [id, userId, title, date, location, agenda, status]
    );
    return session;
  },

  async deleteSession(id, userId) {
    if (dbType === 'json') {
      const session = jsonDb.sessions.find(s => s.id === id && s.user_id === userId);
      if (!session) return false;
      jsonDb.sessions = jsonDb.sessions.filter(s => s.id !== id);
      jsonDb.participants = jsonDb.participants.filter(p => p.session_id !== id);
      jsonDb.transcripts = jsonDb.transcripts.filter(t => t.session_id !== id);
      const sessionMinutes = jsonDb.minutes.find(m => m.session_id === id);
      if (sessionMinutes) {
        jsonDb.action_items = jsonDb.action_items.filter(a => a.minutes_id !== sessionMinutes.id);
        jsonDb.minutes = jsonDb.minutes.filter(m => m.session_id !== id);
      }
      saveJsonDb();
      return true;
    }
    const [result] = await mysqlPool.query('DELETE FROM meeting_sessions WHERE id = ? AND user_id = ?', [id, userId]);
    return result && result.affectedRows > 0;
  },

  // --- Participants ---
  async getParticipants(sessionId) {
    if (dbType === 'json') {
      return jsonDb.participants.filter(p => p.session_id === sessionId);
    }
    const [rows] = await mysqlPool.query('SELECT * FROM meeting_participants WHERE session_id = ?', [sessionId]);
    return rows || [];
  },

  async saveParticipants(sessionId, participantsList) {
    if (dbType === 'json') {
      jsonDb.participants = jsonDb.participants.filter(p => p.session_id !== sessionId);
      jsonDb.participants.push(...participantsList);
      saveJsonDb();
      return participantsList;
    }
    await mysqlPool.query('DELETE FROM meeting_participants WHERE session_id = ?', [sessionId]);
    if (participantsList.length > 0) {
      const values = participantsList.map(p => [p.id, sessionId, p.name, p.position, p.unit]);
      await mysqlPool.query(
        'INSERT INTO meeting_participants (id, session_id, name, position, unit) VALUES ?',
        [values]
      );
    }
    return participantsList;
  },

  async addParticipant(participant) {
    if (dbType === 'json') {
      jsonDb.participants.push(participant);
      saveJsonDb();
      return participant;
    }
    const { id, session_id, name, position, unit } = participant;
    await mysqlPool.query(
      'INSERT INTO meeting_participants (id, session_id, name, position, unit) VALUES (?, ?, ?, ?, ?)',
      [id, session_id, name, position, unit]
    );
    return participant;
  },

  async removeParticipant(participantId) {
    if (dbType === 'json') {
      jsonDb.participants = jsonDb.participants.filter(p => p.id !== participantId);
      saveJsonDb();
      return true;
    }
    await mysqlPool.query('DELETE FROM meeting_participants WHERE id = ?', [participantId]);
    return true;
  },

  // --- Transcripts ---
  async getTranscripts(sessionId) {
    if (dbType === 'json') {
      return jsonDb.transcripts.filter(t => t.session_id === sessionId).sort((a, b) => a.chunk_index - b.chunk_index);
    }
    const [rows] = await mysqlPool.query('SELECT * FROM transcripts WHERE session_id = ? ORDER BY chunk_index ASC', [sessionId]);
    return rows || [];
  },

  async addTranscript(transcript) {
    if (dbType === 'json') {
      jsonDb.transcripts.push(transcript);
      saveJsonDb();
      return transcript;
    }
    const { id, session_id, chunk_index, text, timestamp, speaker_label } = transcript;
    await mysqlPool.query(
      'INSERT INTO transcripts (id, session_id, chunk_index, text, timestamp, speaker_label) VALUES (?, ?, ?, ?, ?, ?)',
      [id, session_id, chunk_index, text, timestamp, speaker_label]
    );
    return transcript;
  },

  async updateTranscriptSpeaker(id, speakerLabel) {
    if (dbType === 'json') {
      const transcript = jsonDb.transcripts.find(t => t.id === id);
      if (transcript) {
        transcript.speaker_label = speakerLabel;
        saveJsonDb();
      }
      return transcript;
    }
    await mysqlPool.query('UPDATE transcripts SET speaker_label = ? WHERE id = ?', [speakerLabel, id]);
    return true;
  },

  async updateTranscriptText(id, text) {
    if (dbType === 'json') {
      const transcript = jsonDb.transcripts.find(t => t.id === id);
      if (transcript) {
        transcript.text = text;
        saveJsonDb();
      }
      return transcript;
    }
    await mysqlPool.query('UPDATE transcripts SET text = ? WHERE id = ?', [text, id]);
    return true;
  },

  async deleteTranscript(id) {
    if (dbType === 'json') {
      jsonDb.transcripts = jsonDb.transcripts.filter(t => t.id !== id);
      saveJsonDb();
      return true;
    }
    await mysqlPool.query('DELETE FROM transcripts WHERE id = ?', [id]);
    return true;
  },

  // --- Minutes (Notulensi) & Action Items ---
  async getMinutes(sessionId) {
    if (dbType === 'json') {
      return jsonDb.minutes.find(m => m.session_id === sessionId) || null;
    }
    const [rows] = await mysqlPool.query('SELECT * FROM minutes WHERE session_id = ?', [sessionId]);
    return rows && rows.length > 0 ? rows[0] : null;
  },

  async saveMinutes(minutes, actionItemsList = []) {
    if (dbType === 'json') {
      jsonDb.minutes = jsonDb.minutes.filter(m => m.session_id !== minutes.session_id);
      jsonDb.minutes.push(minutes);
      
      jsonDb.action_items = jsonDb.action_items.filter(a => a.minutes_id !== minutes.id);
      jsonDb.action_items.push(...actionItemsList);
      
      saveJsonDb();
      return { minutes, actionItemsList };
    }

    await mysqlPool.query('DELETE FROM minutes WHERE session_id = ?', [minutes.session_id]);
    await mysqlPool.query(
      'INSERT INTO minutes (id, session_id, summary, content_json, notes_html) VALUES (?, ?, ?, ?, ?)',
      [minutes.id, minutes.session_id, minutes.summary, minutes.content_json, minutes.notes_html]
    );
    
    await mysqlPool.query('DELETE FROM action_items WHERE minutes_id = ?', [minutes.id]);
    if (actionItemsList.length > 0) {
      const values = actionItemsList.map(a => [a.id, minutes.id, a.description, a.pic, a.due_date, a.status]);
      await mysqlPool.query(
        'INSERT INTO action_items (id, minutes_id, description, pic, due_date, status) VALUES ?',
        [values]
      );
    }
    return { minutes, actionItemsList };
  },

  async getActionItems(minutesId) {
    if (dbType === 'json') {
      return jsonDb.action_items.filter(a => a.minutes_id === minutesId);
    }
    const [rows] = await mysqlPool.query('SELECT * FROM action_items WHERE minutes_id = ?', [minutesId]);
    return rows || [];
  },

  async updateActionItemStatus(id, status) {
    if (dbType === 'json') {
      const item = jsonDb.action_items.find(a => a.id === id);
      if (item) {
        item.status = status;
        saveJsonDb();
      }
      return item;
    }
    await mysqlPool.query('UPDATE action_items SET status = ? WHERE id = ?', [status, id]);
    return true;
  },

  // --- Users ---
  async getUser(id) {
    if (dbType === 'json') {
      if (!jsonDb.users) jsonDb.users = [];
      return jsonDb.users.find(u => u.id === id) || null;
    }
    const [rows] = await mysqlPool.query('SELECT * FROM users WHERE id = ?', [id]);
    return rows && rows.length > 0 ? rows[0] : null;
  },

  async getUserByUsername(username) {
    if (dbType === 'json') {
      if (!jsonDb.users) jsonDb.users = [];
      return jsonDb.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
    }
    const [rows] = await mysqlPool.query('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
    return rows && rows.length > 0 ? rows[0] : null;
  },

  async createUser(user) {
    if (dbType === 'json') {
      if (!jsonDb.users) jsonDb.users = [];
      jsonDb.users.push(user);
      saveJsonDb();
      return user;
    }
    const { id, username, password, fullname, email, role } = user;
    await mysqlPool.query(
      'INSERT INTO users (id, username, password, fullname, email, role) VALUES (?, ?, ?, ?, ?, ?)',
      [id, username, password, fullname, email, role || 'user']
    );
    return user;
  },

  async updateUser(id, updates) {
    if (dbType === 'json') {
      if (!jsonDb.users) jsonDb.users = [];
      const user = jsonDb.users.find(u => u.id === id);
      if (user) {
        Object.assign(user, updates);
        saveJsonDb();
      }
      return user;
    }
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    if (fields.length === 0) return null;

    const setClause = fields.map(f => `${f} = ?`).join(', ');
    await mysqlPool.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, id]);
    return true;
  },

  async countUsers() {
    if (dbType === 'json') {
      if (!jsonDb.users) jsonDb.users = [];
      return jsonDb.users.length;
    }
    const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM users');
    return rows && rows.length > 0 ? rows[0].count : 0;
  },

  async countSessions(userId) {
    if (dbType === 'json') {
      return jsonDb.sessions.filter(s => s.user_id === userId).length;
    }
    const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM meeting_sessions WHERE user_id = ?', [userId]);
    return rows && rows.length > 0 ? rows[0].count : 0;
  },

  async countTranscripts(userId) {
    if (dbType === 'json') {
      const userSessionIds = jsonDb.sessions.filter(s => s.user_id === userId).map(s => s.id);
      return jsonDb.transcripts.filter(t => userSessionIds.includes(t.session_id)).length;
    }
    const [rows] = await mysqlPool.query(
      'SELECT COUNT(t.id) as count FROM transcripts t JOIN meeting_sessions s ON t.session_id = s.id WHERE s.user_id = ?',
      [userId]
    );
    return rows && rows.length > 0 ? rows[0].count : 0;
  },

  async countActionItems(userId, status = null) {
    if (dbType === 'json') {
      const userSessionIds = jsonDb.sessions.filter(s => s.user_id === userId).map(s => s.id);
      const userMinutesIds = jsonDb.minutes.filter(m => userSessionIds.includes(m.session_id)).map(m => m.id);
      let items = jsonDb.action_items.filter(a => userMinutesIds.includes(a.minutes_id));
      if (status) {
        items = items.filter(a => a.status === status);
      }
      return items.length;
    }
    let query = 'SELECT COUNT(a.id) as count FROM action_items a ' +
                'JOIN minutes m ON a.minutes_id = m.id ' +
                'JOIN meeting_sessions s ON m.session_id = s.id ' +
                'WHERE s.user_id = ?';
    const params = [userId];
    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }
    const [rows] = await mysqlPool.query(query, params);
    return rows && rows.length > 0 ? rows[0].count : 0;
  }
};
