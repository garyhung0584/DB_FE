const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const debug = false;

const hashPassword = (password, createdAt) => {
  if (!debug) {
    const salt = bcrypt.genSaltSync(10);
    return bcrypt.hashSync(password + createdAt, salt);
  } else {
    return password;
  }
};

const createUser = async (req, res) => {
  const { username, email, password } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Get the current time
    const createdAt = new Date();

    // Hash the password
    const finalPassword = hashPassword(password, createdAt);


    // Insert user
    const [result] = await connection.query(
      'INSERT INTO users (username, email, password, created_at) VALUES (?, ?, ?,? )',
      [username, email, finalPassword, createdAt]
    );

    await connection.commit();
    res.status(201).json({ id: result.insertId, username, email, createdAt });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

const getUsers = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserByToken = async (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  const jwtSecret = process.env.JWT_SECRET || 'default_secret';

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query('DELETE FROM users WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      throw new Error('User not found');
    }

    await connection.commit();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const createdAt = user.created_at;

    let isPasswordValid;
    if (!debug) {
      // Salt the input password with created_at
      isPasswordValid = await bcrypt.compare(password + createdAt, user.password);
    } else {
      isPasswordValid = password === user.password;
    }

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const jwtSecret = process.env.JWT_SECRET || 'default_secret';

    const [adminRows] = await pool.query('SELECT user_id FROM admins WHERE user_id = ?', [user.id]);
    let role = adminRows.length > 0 ? 'admin' : 'user';

    const [sellerRows] = await pool.query('SELECT user_id FROM sellers WHERE user_id = ?', [user.id]);
    role = sellerRows.length > 0 ? 'seller' : role;

    const token = jwt.sign({ id: user.id, role: role }, jwtSecret, { expiresIn: '1h' });
    res.json({ token, role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getUserList = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM users 
      WHERE id NOT IN (SELECT user_id FROM sellers) 
      AND id NOT IN (SELECT user_id FROM admins)
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getSellerList = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM users 
      WHERE id IN (SELECT user_id FROM sellers)
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, email, password } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [user] = await connection.query('SELECT * FROM users WHERE id = ?', [id]);
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = {
      username: username || user[0].username,
      email: email || user[0].email,
      password: password ? hashPassword(password, user[0].created_at) : user[0].password,
    };

    await connection.query(
      'UPDATE users SET username = ?, email = ?, password = ? WHERE id = ?',
      [updatedUser.username, updatedUser.email, updatedUser.password, id]
    );

    await connection.commit();
    res.json({ message: 'User updated successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
};

module.exports = {
  createUser,
  getUsers,
  deleteUser,
  loginUser,
  getUserByToken,
  getUserList,
  getSellerList,
  updateUser,
};