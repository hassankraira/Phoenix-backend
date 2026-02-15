const express = require('express');
const fs = require('fs');
const https = require('https');
const cors = require('cors');
const oracledb = require('oracledb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;
const bcrypt = require('bcrypt');

app.use(cors());
app.use(express.json());
process.env.TNS_ADMIN = path.join(__dirname, 'oracle', 'wallet'); // folder with wallet
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectString: process.env.DB_CONNECT_STRING
};
async function init() {
  try {
    const connection = await oracledb.getConnection(dbConfig);
    console.log('✅ Connected to Oracle DB');
    connection.release();
  } catch (err) {
    console.error('DB connection error:', err);
  }
  
}
init();
const axios = require('axios');

async function getMyPublicIP() {
  try {
    const res = await axios.get('https://api.ipify.org');
    console.log('🌐 My Public IP on Back4app is:', res.data);
  } catch (err) {
    console.log('❌ Could not fetch Public IP');
  }
}

getMyPublicIP();

app.get('/test-db', async (req, res) => {
  try {
    const connection = await oracledb.getConnection(dbConfig);
    res.send('✅ DB connection successful!');
    connection.release();
  } catch (err) {
    console.error('DB test error:', err);
    res.status(500).send('❌ DB connection failed!');
  }
});
app.get('/tables', async (req, res) => {
  try {
    const connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(`SELECT table_name FROM user_tables`);
    const tables = result.rows.map(row => row[0]);
    await connection.close();
    res.json({ tables });
  } catch (err) {
    console.error('Error fetching tables:', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/teachers', async (req, res) => {

  try {
    const connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT *
      FROM TEACHERS t
      WHERE t.TEACHER_ID NOT IN (
        SELECT TEACHER_ID
        FROM USERS
        WHERE ROLE = 'admin'
      )
      ORDER BY t.TEACHER_ID`,
    );

    await connection.close();
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { Username, password } = req.body;

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 1️⃣ نبحث عن المستخدم
    const userResult = await connection.execute(
      `
      SELECT USER_ID, USERNAME, PASSWORD, ROLE, TEACHER_ID
      FROM USERS
      WHERE USERNAME = :Username
      `,
      { Username },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const dbUser = userResult.rows[0];

    if (!dbUser) {
      return res.status(401).json({ error: 'اسم المستخدم غير موجود' });
    }

    // 2️⃣ التحقق من كلمة المرور
    const match = await bcrypt.compare(password, dbUser.PASSWORD);

    if (!match) {
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }

    let userResponse = {
      id: dbUser.USER_ID,
      username: dbUser.USERNAME,
      Role: dbUser.ROLE,
      teacherId:dbUser.TEACHER_ID

    };

    // 3️⃣ لو مدرس → نجيب بياناته
    if (dbUser.ROLE === 'teacher'||'admin') {
      const teacherResult = await connection.execute(
        `
        SELECT
          TEACHER_ID,
          FIRST_NAME,
          LAST_NAME,
          PHONE_NUMBER,
          GENDER,
          IMAGE,
          SUBJECT,
          GOLDEN
        FROM TEACHERS
        WHERE TEACHER_ID = :teacherId
        `,
        { teacherId: dbUser.TEACHER_ID },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      const teacher = teacherResult.rows[0];

      if (teacher) {
        userResponse = {
          ...userResponse,
          teacherId: teacher.TEACHER_ID,
          firstName: teacher.FIRST_NAME,
          lastName: teacher.LAST_NAME,
          phone: teacher.PHONE_NUMBER,
          gender: teacher.GENDER,
          image: teacher.IMAGE,
          subject: teacher.SUBJECT,
          golden: teacher.GOLDEN
        };
      }
    }

    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user: userResponse
    });

  } catch (err) {
    console.error('❌ Error in login:', err);
    res.status(500).json({ error: 'خطأ أثناء تسجيل الدخول' });
  } finally {
    if (connection) await connection.close();
  }
});

function generateWhatsAppLink(phone, username, password) {
  const text = `
مرحبًا 👋
تم إنشاء حسابك في منصة Phoenix التعليمية ✅

اسم المستخدم: ${username}
كلمة المرور: ${password}

رابط الدخول:
https://phoenix-center.com/login

⚠️ يرجى تغيير كلمة المرور بعد أول تسجيل دخول
`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}



app.post('/api/admin/teachers', async (req, res) => {
  const { FIRST_NAME, LAST_NAME, PHONE_NUMBER, GENDER, IMAGE, SUBJECT, GOLDEN,youtubeUrl  } = req.body;

  const defaultPassword = '123456';
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);
  
  try {
    connection = await oracledb.getConnection(dbConfig);
  
    // إضافة المدرس
    const teacherResult = await connection.execute(
      `INSERT INTO TEACHERS
        (TEACHER_ID, FIRST_NAME, LAST_NAME, PHONE_NUMBER, GENDER, IMAGE, SUBJECT, GOLDEN, YOUTUBE_URL)
       VALUES
        (TEACHERS_SEQ.NEXTVAL, :FIRST_NAME, :LAST_NAME, :PHONE_NUMBER, :GENDER, :IMAGE, :SUBJECT, :GOLDEN, :YOUTUBE_URL)
       RETURNING TEACHER_ID INTO :id`,
      {
        FIRST_NAME,
        LAST_NAME,
        PHONE_NUMBER: PHONE_NUMBER || null,
        GENDER: GENDER || null,
        IMAGE: IMAGE || null,
        SUBJECT: SUBJECT || null,
        GOLDEN: GOLDEN || 'N',
        YOUTUBE_URL: youtubeUrl || null,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: false }
    );
  
    const TEACHER_ID = teacherResult.outBinds.id[0];
    const clean = str => str.toLowerCase().replace(/\s+/g,'');
    const username = `${clean(FIRST_NAME)}_${clean(LAST_NAME)}_${TEACHER_ID}`;
  
    // إضافة المستخدم
    await connection.execute(
      `INSERT INTO USERS (USER_ID, USERNAME, PASSWORD, ROLE, TEACHER_ID)
       VALUES (USERS_SEQ.NEXTVAL, :USERNAME, :PASSWORD, :ROLE, :TEACHER_ID)`,
      {
        USERNAME: username,
        PASSWORD: hashedPassword,
        ROLE: 'teacher',
        TEACHER_ID
      },
      { autoCommit: false } // نؤجل حتى الآن
    );
  
    await connection.commit(); // ✅ حفظ كل شيء مرة واحدة
  
    res.status(201).json({
      TEACHER_ID,
      FIRST_NAME,
      LAST_NAME,
      PHONE_NUMBER: PHONE_NUMBER || null,
      GENDER: GENDER || null,
      IMAGE: IMAGE || null,
      SUBJECT: SUBJECT || null,
      GOLDEN: GOLDEN || 'N',
      YOUTUBE_URL:youtubeUrl || null,
      USERNAME: username,
      WHATSAPP_LINK: generateWhatsAppLink(PHONE_NUMBER, username, defaultPassword)
    });
  
  } catch (err) {
    if (connection) await connection.rollback(); // 🔄 التراجع عند الخطأ
    console.error('❌ Error adding teacher:', err);
    res.status(500).json({ error: 'خطأ أثناء إضافة المدرس: ' + err.message });
  } finally {
    if (connection) await connection.close();
  }
  
});

app.post('/api/change-password', async (req, res) => {
  const { USER_ID, CURRENT_PASSWORD, NEW_PASSWORD } = req.body;
  const strongPasswordRegx = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

  if (!strongPasswordRegx.test(NEW_PASSWORD)) {
    return res.status(400).json({ error: 'كلمة المرور لا تستوفي شروط القوة المطلوبة' });
  }
  if (!USER_ID || !CURRENT_PASSWORD || !NEW_PASSWORD) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 1️⃣ جلب كلمة المرور الحالية من قاعدة البيانات
    const result = await connection.execute(
      `SELECT PASSWORD FROM USERS WHERE USER_ID = :USER_ID`,
      { USER_ID },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const storedHashedPassword = result.rows[0].PASSWORD;

    // 2️⃣ التحقق من كلمة المرور الحالية
    const isMatch = await bcrypt.compare(CURRENT_PASSWORD, storedHashedPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    // 3️⃣ تشفير كلمة المرور الجديدة
    const hashedNewPassword = await bcrypt.hash(NEW_PASSWORD, 10);

    // 4️⃣ تحديث كلمة المرور في قاعدة البيانات
    await connection.execute(
      `UPDATE USERS SET PASSWORD = :NEW_PASSWORD WHERE USER_ID = :USER_ID`,
      { NEW_PASSWORD: hashedNewPassword, USER_ID },
      { autoCommit: true }
    );

    res.json({ message: 'تم تحديث كلمة المرور بنجاح ✅' });

  } catch (err) {
    console.error('❌ Error changing password:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تغيير كلمة المرور' });
  } finally {
    if (connection) await connection.close();
  }
});

app.put('/api/admin/teachers/:id', async (req, res) => {
  const { FIRST_NAME, LAST_NAME, PHONE_NUMBER, GENDER, IMAGE, SUBJECT, GOLDEN, youtubeUrl } = req.body;
  const { id } = req.params;
  
  try {
    connection = await oracledb.getConnection(dbConfig);

    await connection.execute(
      `UPDATE TEACHERS
       SET FIRST_NAME=:FIRST_NAME,
           LAST_NAME=:LAST_NAME,
           PHONE_NUMBER=:PHONE_NUMBER,
           GENDER=:GENDER,
           IMAGE=:IMAGE,
           SUBJECT=:SUBJECT,
           GOLDEN=:GOLDEN,
           YOUTUBE_URL=:YOUTUBE_URL
       WHERE TEACHER_ID=:TEACHER_ID`,
      {
        FIRST_NAME,
        LAST_NAME,
        PHONE_NUMBER: PHONE_NUMBER || null,
        GENDER: GENDER || null,
        IMAGE: IMAGE || null,
        SUBJECT: SUBJECT || null,
        GOLDEN: GOLDEN || 'N',
        YOUTUBE_URL: youtubeUrl || null,
        TEACHER_ID: id
      },
      { autoCommit: true }
    );

    res.json({ success: true });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) await connection.close();
  }
});

app.delete('/api/admin/teachers/:id', async (req, res) => {
  const teacherId = req.params.id;
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 1️⃣ ATTENDANCE
    await connection.execute(`
      DELETE FROM ATTENDANCE
      WHERE SCHEDULE_ID IN (
        SELECT SCHEDULE_ID FROM SCHEDULE
        WHERE GROUP_ID IN (
          SELECT GROUP_ID FROM GROUPS WHERE TEACHER_ID = :id
        )
      )
    `, [teacherId]);

    // 2️⃣ STUDENT_NOTES
    await connection.execute(`
      DELETE FROM STUDENT_NOTES
      WHERE SCHEDULE_ID IN (
        SELECT SCHEDULE_ID FROM SCHEDULE
        WHERE GROUP_ID IN (
          SELECT GROUP_ID FROM GROUPS WHERE TEACHER_ID = :id
        )
      )
    `, [teacherId]);

    // 3️⃣ STUDENT_GROUP_FEES 🔥
    await connection.execute(`
      DELETE FROM STUDENT_GROUP_FEES
      WHERE GROUP_ID IN (
        SELECT GROUP_ID FROM GROUPS WHERE TEACHER_ID = :id
      )
    `, [teacherId]);

    // 4️⃣ GROUP_STUDENTS
    await connection.execute(`
      DELETE FROM GROUP_STUDENTS
      WHERE GROUP_ID IN (
        SELECT GROUP_ID FROM GROUPS WHERE TEACHER_ID = :id
      )
    `, [teacherId]);

    // 5️⃣ SCHEDULE
    await connection.execute(`
      DELETE FROM SCHEDULE
      WHERE GROUP_ID IN (
        SELECT GROUP_ID FROM GROUPS WHERE TEACHER_ID = :id
      )
    `, [teacherId]);

    // 6️⃣ GROUPS
    await connection.execute(`
      DELETE FROM GROUPS WHERE TEACHER_ID = :id
    `, [teacherId]);

    // 7️⃣ USERS
    await connection.execute(`
      DELETE FROM USERS WHERE TEACHER_ID = :id
    `, [teacherId]);

    // 8️⃣ TEACHERS
    const result = await connection.execute(`
      DELETE FROM TEACHERS WHERE TEACHER_ID = :id
    `, [teacherId]);

    if (result.rowsAffected === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'المدرس غير موجود' });
    }

    await connection.commit();
    res.json({ message: 'تم حذف المدرس وكل البيانات المرتبطة به بنجاح' });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('DELETE TEACHER ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) await connection.close();
  }
});



app.get('/api/Grads', async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `
      SELECT * FROM GRADES
      `,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في جلب الصفوف' });
  } finally {
    if (connection) await connection.close();
  }
});

app.get('/api/students', async (req, res) => {
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `
      SELECT * FROM STUDENTS
      `,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'خطأ في جلب الطلاب' });
  } finally {
    if (connection) await connection.close();
  }
});



app.post('/api/admin/students', async (req, res) => {
  const { NAME, PHONE, GRADE_ID } = req.body;
  if (!NAME || !GRADE_ID) return res.status(400).json({ error: 'الاسم والصف مطلوبان' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    const result = await conn.execute(
      `INSERT INTO STUDENTS (STUDENT_ID, NAME, PHONE, GRADE_ID) VALUES (STUDENTS_SEQ.NEXTVAL, :NAME, :PHONE, :GRADE_ID) RETURNING STUDENT_ID INTO :id`,
      { NAME, PHONE, GRADE_ID, id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
    );

    await conn.commit();

    res.json({ STUDENT_ID: result.outBinds.id[0], NAME, PHONE, GRADE_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.put('/api/admin/students/:id', async (req, res) => {
  const STUDENT_ID = Number(req.params.id);
  const { NAME, PHONE, GRADE_ID } = req.body;

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    await conn.execute(`DELETE FROM GROUP_STUDENTS WHERE STUDENT_ID=:STUDENT_ID`, { STUDENT_ID });
    await conn.execute(
      `UPDATE STUDENTS SET NAME=:NAME, PHONE=:PHONE, GRADE_ID=:GRADE_ID WHERE STUDENT_ID=:STUDENT_ID`,
      { NAME, PHONE, GRADE_ID, STUDENT_ID }
    );
    await conn.commit();
    res.json({ STUDENT_ID, NAME, PHONE, GRADE_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.delete('/api/admin/students/:id', async (req, res) => {
  const STUDENT_ID = Number(req.params.id);
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    // 1️⃣ ATTENDANCE
    await conn.execute(
      `DELETE FROM ATTENDANCE WHERE STUDENT_ID = :STUDENT_ID`,
      { STUDENT_ID }
    );

    // 2️⃣ STUDENT_NOTES
    await conn.execute(
      `DELETE FROM STUDENT_NOTES WHERE STUDENT_ID = :STUDENT_ID`,
      { STUDENT_ID }
    );

    // 3️⃣ STUDENT_GROUP_FEES
    await conn.execute(
      `DELETE FROM STUDENT_GROUP_FEES WHERE STUDENT_ID = :STUDENT_ID`,
      { STUDENT_ID }
    );

    // 4️⃣ GROUP_STUDENTS
    await conn.execute(
      `DELETE FROM GROUP_STUDENTS WHERE STUDENT_ID = :STUDENT_ID`,
      { STUDENT_ID }
    );

    // 5️⃣ STUDENTS
    const result = await conn.execute(
      `DELETE FROM STUDENTS WHERE STUDENT_ID = :STUDENT_ID`,
      { STUDENT_ID }
    );

    if (result.rowsAffected === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'الطالب غير موجود' });
    }

    await conn.commit();
    res.json({ message: 'تم حذف الطالب وكل البيانات المرتبطة به بنجاح' });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('DELETE STUDENT ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});





app.get('/api/admin/groups', async (req, res) => {
  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(`
      SELECT 
        g.GROUP_ID,
        g.NAME,
        g.GRADE_ID,
        g.TEACHER_ID,
        t.FIRST_NAME || ' ' || t.LAST_NAME AS TEACHER_NAME
      FROM GROUPS g
      LEFT JOIN TEACHERS t ON t.TEACHER_ID = g.TEACHER_ID
      ORDER BY g.GROUP_ID DESC
    `);

    await conn.close();
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/admin/groups', async (req, res) => {
  const { NAME, gradeId, teacherId } = req.body;

  if (!NAME || !gradeId || !teacherId) {
    return res.status(400).json({ error: 'البيانات غير مكتملة' });
  }

  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      `
      INSERT INTO GROUPS (GROUP_ID, NAME, GRADE_ID, TEACHER_ID)
      VALUES (GROUPS_SEQ.NEXTVAL, :NAME, :gradeId, :teacherId)
      RETURNING GROUP_ID INTO :id
      `,
      {
        NAME,          // ✅ الصحيح
        gradeId,
        teacherId,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    res.status(201).json({
      GROUP_ID: result.outBinds.id[0],
      NAME,
      GRADE_ID: gradeId,
      TEACHER_ID: teacherId
    });

  } catch (err) {

    if (err.errorNum === 1) {
      return res.status(400).json({ error: 'اسم المجموعة موجود بالفعل' });
    }

    console.error('ADD GROUP ERROR:', err);
    res.status(500).json({ error: err.message });

  } finally {
    if (conn) await conn.close();
  }
});

app.put('/api/admin/groups/:id', async (req, res) => {
  const GROUP_ID = parseInt(req.params.id, 10);

  const GROUP_NAME = (req.body.GROUP_NAME ?? req.body.NAME ?? '').toString().trim();
  const newGradeId = Number(req.body.GRADE_ID ?? req.body.gradeId);     // ✅ هنا
  const TEACHER_ID = Number(req.body.TEACHER_ID ?? req.body.teacherId); // ✅ هنا

  if (Number.isNaN(GROUP_ID)) return res.status(400).json({ error: "GROUP_ID invalid" });
  if (!GROUP_NAME) return res.status(400).json({ error: "GROUP_NAME required" });
  if (Number.isNaN(newGradeId)) return res.status(400).json({ error: "GRADE_ID invalid" });
  if (Number.isNaN(TEACHER_ID)) return res.status(400).json({ error: "TEACHER_ID invalid" });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    // هات الصف القديم فقط
    const current = await conn.execute(
      `SELECT GRADE_ID FROM GROUPS WHERE GROUP_ID = :GROUP_ID`,
      { GROUP_ID }
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'GROUP not found' });
    }

    const oldGradeId = Number(current.rows[0][0]);

    // ✅ الحذف فقط لو الصف اتغير
    if (oldGradeId !== newGradeId) {
      await conn.execute(
        `DELETE FROM GROUP_STUDENTS WHERE GROUP_ID = :GROUP_ID`,
        { GROUP_ID }
      );
    }

    // تحديث بيانات المجموعة (حتى لو المعلم اتغير مش هيعمل حذف)
    await conn.execute(
      `UPDATE GROUPS
       SET NAME      = :GROUP_NAME,
           GRADE_ID   = :GRADE_ID,
           TEACHER_ID = :TEACHER_ID
       WHERE GROUP_ID = :GROUP_ID`,
      { GROUP_NAME, GRADE_ID: newGradeId, TEACHER_ID, GROUP_ID }
    );

    await conn.commit();
    res.json({ GROUP_ID, GROUP_NAME, GRADE_ID: newGradeId, TEACHER_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});



app.delete('/api/admin/groups/:id', async (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'GROUP_ID غير صحيح' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    // 1️⃣ ATTENDANCE (عبر SCHEDULE)
    await conn.execute(`
      DELETE FROM ATTENDANCE
      WHERE SCHEDULE_ID IN (
        SELECT SCHEDULE_ID FROM SCHEDULE WHERE GROUP_ID = :groupId
      )
    `, { groupId });

    // 2️⃣ STUDENT_NOTES
    await conn.execute(`
      DELETE FROM STUDENT_NOTES
      WHERE SCHEDULE_ID IN (
        SELECT SCHEDULE_ID FROM SCHEDULE WHERE GROUP_ID = :groupId
      )
    `, { groupId });

    // 3️⃣ STUDENT_GROUP_FEES
    await conn.execute(
      `DELETE FROM STUDENT_GROUP_FEES WHERE GROUP_ID = :groupId`,
      { groupId }
    );

    // 4️⃣ GROUP_STUDENTS
    await conn.execute(
      `DELETE FROM GROUP_STUDENTS WHERE GROUP_ID = :groupId`,
      { groupId }
    );

    // 5️⃣ SCHEDULE
    await conn.execute(
      `DELETE FROM SCHEDULE WHERE GROUP_ID = :groupId`,
      { groupId }
    );

    // 6️⃣ GROUPS
    const result = await conn.execute(
      `DELETE FROM GROUPS WHERE GROUP_ID = :groupId`,
      { groupId }
    );

    if (result.rowsAffected === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    await conn.commit();
    res.json({ message: 'تم حذف المجموعة وكل البيانات المرتبطة بها' });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error('DELETE GROUP ERROR:', err);

    if (err?.errorNum === 2292) {
      return res.status(400).json({
        error: 'لا يمكن حذف المجموعة لوجود بيانات مرتبطة بها'
      });
    }

    res.status(500).json({ error: err.message });

  } finally {
    if (conn) await conn.close();
  }
});

app.get('/api/admin/groups/:id/students', async (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'GROUP_ID غير صحيح' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      `
      SELECT s.STUDENT_ID, s.NAME, s.PHONE, s.GRADE_ID
      FROM GROUP_STUDENTS gs
      JOIN STUDENTS s ON s.STUDENT_ID = gs.STUDENT_ID
      WHERE gs.GROUP_ID = :groupId
      ORDER BY s.NAME
      `,
      { groupId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET GROUP STUDENTS ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.get('/api/admin/groups/:id/eligible-students', async (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'GROUP_ID غير صحيح' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    // نجيب GRADE_ID للمجموعة
    const groupRes = await conn.execute(
      `SELECT GRADE_ID FROM GROUPS WHERE GROUP_ID = :groupId`,
      { groupId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const groupRow = groupRes.rows[0];
    if (!groupRow) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const gradeId = groupRow.GRADE_ID;

    // طلاب نفس الصف واللي مش داخلين في المجموعة
    const result = await conn.execute(
      `
      SELECT s.STUDENT_ID, s.NAME, s.PHONE, s.GRADE_ID
      FROM STUDENTS s
      WHERE s.GRADE_ID = :gradeId
        AND NOT EXISTS (
          SELECT 1 FROM GROUP_STUDENTS gs
          WHERE gs.GROUP_ID = :groupId
            AND gs.STUDENT_ID = s.STUDENT_ID
        )
      ORDER BY s.NAME
      `,
      { gradeId, groupId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows);

  } catch (err) {
    console.error('GET ELIGIBLE STUDENTS ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});
app.get('/api/admin/groups/:id/eligible-students', async (req, res) => {
  const groupId = Number(req.params.id);
  if (!groupId) return res.status(400).json({ error: 'GROUP_ID غير صحيح' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    // نجيب GRADE_ID للمجموعة
    const groupRes = await conn.execute(
      `SELECT GRADE_ID FROM GROUPS WHERE GROUP_ID = :groupId`,
      { groupId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const groupRow = groupRes.rows[0];
    if (!groupRow) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const gradeId = groupRow.GRADE_ID;

    // طلاب نفس الصف واللي مش داخلين في المجموعة
    const result = await conn.execute(
      `
      SELECT s.STUDENT_ID, s.NAME, s.PHONE, s.GRADE_ID
      FROM STUDENTS s
      WHERE s.GRADE_ID = :gradeId
        AND NOT EXISTS (
          SELECT 1 FROM GROUP_STUDENTS gs
          WHERE gs.GROUP_ID = :groupId
            AND gs.STUDENT_ID = s.STUDENT_ID
        )
      ORDER BY s.NAME
      `,
      { gradeId, groupId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    res.json(result.rows);

  } catch (err) {
    console.error('GET ELIGIBLE STUDENTS ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.post('/api/admin/groups/:id/students', async (req, res) => {
  const groupId = Number(req.params.id);
  const { studentId } = req.body;

  if (!groupId) return res.status(400).json({ error: 'GROUP_ID غير صحيح' });
  if (!studentId) return res.status(400).json({ error: 'studentId مطلوب' });

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    // (اختياري لكن مهم) تأكد إن الطالب من نفس الصف
    const gradeCheck = await conn.execute(
      `
      SELECT 1
      FROM GROUPS g
      JOIN STUDENTS s ON s.GRADE_ID = g.GRADE_ID
      WHERE g.GROUP_ID = :groupId
        AND s.STUDENT_ID = :studentId
      `,
      { groupId, studentId: Number(studentId) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!gradeCheck.rows.length) {
      return res.status(400).json({ error: 'لا يمكن إضافة طالب من صف مختلف عن صف المجموعة' });
    }

    await conn.execute(
      `INSERT INTO GROUP_STUDENTS (GROUP_ID, STUDENT_ID) VALUES (:groupId, :studentId)`,
      { groupId, studentId: Number(studentId) },
      { autoCommit: true }
    );

    res.status(201).json({ message: 'تمت إضافة الطالب للمجموعة' });

  } catch (err) {
    console.error('ADD STUDENT TO GROUP ERROR:', err);

    // ORA-00001 unique constraint => الطالب موجود بالفعل
    if (err && err.errorNum === 1) {
      return res.status(400).json({ error: 'الطالب موجود بالفعل في المجموعة' });
    }

    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.delete('/api/admin/groups/:groupId/students/:studentId', async (req, res) => {
  const groupId = Number(req.params.groupId);
  const studentId = Number(req.params.studentId);

  if (!groupId || !studentId) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      `DELETE FROM GROUP_STUDENTS WHERE GROUP_ID=:groupId AND STUDENT_ID=:studentId`,
      { groupId, studentId },
      { autoCommit: true }
    );

    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'العلاقة غير موجودة' });
    }

    res.json({ message: 'تمت إزالة الطالب من المجموعة' });

  } catch (err) {
    console.error('REMOVE STUDENT ERROR:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.close();
  }
});





app.get('/api/Rooms', async (req, res) => {
  try {
    const connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(`
    SELECT 
    r.ROOM_ID,      -- item[0]
    r.NAME,         -- item[1]
    r.CAPACITY,     -- item[2]
    r.NOTE,         -- item[3]
    r.IS_ACTIVE,    -- item[4]
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM SCHEDULE s
        WHERE s.ROOM_ID = r.ROOM_ID
          -- 1. التأكد من اليوم بتوقيت القاهرة وبدون مسافات زائدة
          AND TRIM(s.DAY) = TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'Africa/Cairo', 'FMDAY', 'NLS_DATE_LANGUAGE=ARABIC')
          
          -- 2. تحويل وقت السيرفر (دبي) إلى وقت القاهرة (مصر) ثم المقارنة
          AND TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'Africa/Cairo', 'HH24:MI') 
              BETWEEN TO_CHAR(s.START_TIME, 'HH24:MI') 
                  AND TO_CHAR(s.END_TIME, 'HH24:MI')
      )
      THEN 1
      ELSE 0
    END AS IS_OCCUPIED -- item[5]
FROM ROOMS r
ORDER BY r.ROOM_ID

  `);

    await connection.close();
    res.status(200).json(result.rows);

  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/schedules', async (req, res) => {
  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `SELECT s.SCHEDULE_ID,
      s.GROUP_ID,
      g.NAME AS GROUP_NAME,
      s.ROOM_ID,
      r.NAME AS ROOM_NAME,
      s.CLASS_DATE,
      s.START_TIME,
      s.END_TIME,
      s.DAY,
      t.FIRST_NAME || ' ' || t.LAST_NAME AS TEACHER
      FROM SCHEDULE s
LEFT JOIN GROUPS g ON s.GROUP_ID = g.GROUP_ID
LEFT JOIN ROOMS r ON s.ROOM_ID = r.ROOM_ID
LEFT JOIN TEACHERS t ON g.TEACHER_ID = t.TEACHER_ID
ORDER BY s.SCHEDULE_ID
`,
      [], // لا قيم للـ bind variables
      { outFormat: oracledb.OUT_FORMAT_OBJECT } // يرجع لك JSON جاهز
    );

    res.status(200).json(result.rows);

  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
});



app.post('/api/schedules', async (req, res) => {
  const schedules = req.body; // مصفوفة من الـ Schedule من الفرونت

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);
    
    for (const s of schedules) {
      if ( !s.start_time) {
        console.warn(`تنبيه: سجل مفقود التاريخ أو الوقت، تم تخطيه. ID: ${s.schedule_id}`);
        continue; 
      }

      // 2. تكوين التاريخ الكامل
      const dummyDate = '2026-01-01'; 

      const startDateTime = new Date(`${dummyDate}T${s.start_time}:00`);
      const endDateTime = new Date(`${dummyDate}T${s.end_time}:00`);

      // 3. التحقق من صحة التحويل
      if (isNaN(startDateTime.getTime())) {
        console.error("خطأ في تنسيق التاريخ المرسل:", s.class_date);
        continue;
      }
      // دمج التاريخ مع الوقت لتكوين TIMESTAMP كامل
      const classDateStr = s.class_date; 

      // دمج صحيح لإنشاء كائن Date

    
      if (s._state === 'new') {
        await connection.execute(
          `INSERT INTO SCHEDULE (GROUP_ID, ROOM_ID, CLASS_DATE, START_TIME, END_TIME, DAY)
           VALUES (:groupId, :roomId, :classDate, :startTime, :endTime, :day)`,
          {
            groupId: s.group_id,
            roomId: s.room_id,
            classDate: new Date(s.class_date), // مجرد التاريخ
            startTime: startDateTime,          // TIMESTAMP كامل
            endTime: endDateTime,              // TIMESTAMP كامل
            day: s.days
          },
          { autoCommit: true }
        );
      } else if (s._state === 'updated') {
        await connection.execute(
          `UPDATE SCHEDULE
           SET GROUP_ID = :groupId,
               ROOM_ID = :roomId,
               CLASS_DATE = :classDate,
               START_TIME = :startTime,
               END_TIME = :endTime,
               DAY = :day
           WHERE SCHEDULE_ID = :scheduleId`,
          {
            scheduleId: s.schedule_id,
            groupId: s.group_id,
            roomId: s.room_id,
            classDate: new Date(s.class_date),
            startTime: startDateTime,
            endTime: endDateTime,
            day: s.days
          },
          { autoCommit: true }
        );
      }
      // أضف هذا الشرط داخل الـ for loop في الباكيند
else if (s._state === 'deleted') {
  await connection.execute(
    `DELETE FROM SCHEDULE WHERE SCHEDULE_ID = :scheduleId`,
    { scheduleId: s.schedule_id },
    { autoCommit: true }
  );
}
    }
    
    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) {
      try {
        await connection.close();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
});



app.get('/api/studentfinance', async (req, res) => {
  try {
    const connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(`
    SELECT 
    G.GROUP_ID,
    G.NAME AS GROUP_NAME,
    SGF.FEE_MONTH,
    SGF.FEE_YEAR,
    NVL(SGF.IS_PAID, 0) AS IS_PAID,
    NVL(SGF.AMOUNT_PAID, 0) AS AMOUNT_PAID
FROM GROUP_STUDENTS SG
JOIN GROUPS G ON G.GROUP_ID = SG.GROUP_ID
LEFT JOIN STUDENT_GROUP_FEES SGF 
    ON SGF.STUDENT_ID = SG.STUDENT_ID 
   AND SGF.GROUP_ID = SG.GROUP_ID 
   AND SGF.FEE_YEAR = :YEAR
WHERE SG.STUDENT_ID = :STUDENT_ID
ORDER BY G.GROUP_ID, SGF.FEE_MONTH

    `, {
      STUDENT_ID: Number(req.query.STUDENT_ID),
      YEAR: Number(req.query.YEAR)
    });

    await connection.close();

    res.status(200).json(result.rows);

  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/cash-report', async (req, res) => {
  const { type, year, month, day } = req.query;

  let whereClause = `
    SGF.IS_PAID = 1
    AND SGF.CREATED_AT IS NOT NULL
  `;
  const binds = {};

  // 🗓️ يومي
  if (type === 'daily') {
    if (!day) {
      return res.status(400).json({ message: 'day is required (YYYY-MM-DD)' });
    }

    whereClause += `
      AND TRUNC(SGF.CREATED_AT) = TO_DATE(:day, 'YYYY-MM-DD')
      `;
    binds.day = day;
  }

  // 📆 شهري
  else if (type === 'monthly') {
    if (!month || !year) {
      return res.status(400).json({ message: 'month & year are required' });
    }

    whereClause += `
      AND EXTRACT(MONTH FROM SGF.CREATED_AT) = :month
      AND EXTRACT(YEAR  FROM SGF.CREATED_AT) = :year
    `;
    binds.month = Number(month);
    binds.year  = Number(year);
  }

  // 🗓️ سنوي
  else if (type === 'yearly') {
    if (!year) {
      return res.status(400).json({ message: 'year is required' });
    }

    whereClause += `
      AND EXTRACT(YEAR FROM SGF.CREATED_AT) = :year
    `;
    binds.year = Number(year);
  }

  else {
    return res.status(400).json({ message: 'type must be daily | monthly | yearly' });
  }

  try {
    const connection = await oracledb.getConnection(dbConfig);

    const result = await connection.execute(
      `
      SELECT
      TO_CHAR(SGF.CREATED_AT, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_AT,
      SGF.FEE_MONTH,
        S.NAME AS STUDENT_NAME,
        G.NAME AS GROUP_NAME,
        SGF.AMOUNT_PAID
      FROM STUDENT_GROUP_FEES SGF
      JOIN STUDENTS S ON S.STUDENT_ID = SGF.STUDENT_ID
      JOIN GROUPS   G ON G.GROUP_ID = SGF.GROUP_ID
      WHERE ${whereClause}
      ORDER BY SGF.CREATED_AT DESC
      `,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    await connection.close();

    res.json(
      result.rows.map(r => ({
        createdAt: r.CREATED_AT,
        studentName: r.STUDENT_NAME,
        groupName: r.GROUP_NAME,
        amount: r.AMOUNT_PAID,
        paidMonth: r.FEE_MONTH   // أو تحويله لاسم شهر
      }))
    );
    

  } catch (err) {
    console.error('Cash report error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// البحث عن الطالب بالاسم
app.get('/api/students/search', async (req, res) => {
  try {
    const connection = await oracledb.getConnection(dbConfig);
    const name = req.query.name;

    const result = await connection.execute(
      `SELECT STUDENT_ID, NAME 
       FROM STUDENTS 
       WHERE LOWER(NAME) LIKE LOWER(:name)`,
      { name: `%${name}%` }
    );

    await connection.close();

    res.status(200).json(result.rows.map(r => ({
      id: r[0],
      name: r[1]
    })));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/studentfinance/update
app.post('/api/studentfinance/update', async (req, res) => {
  try {
    const {
      studentId,
      year,
      groupId,
      month,
      amountPaid,
      isPaid,
      createdAt
    } = req.body;

    if (!studentId || !year || !groupId || !month || !createdAt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const connection = await oracledb.getConnection(dbConfig);

    const checkResult = await connection.execute(
      `
      SELECT COUNT(*) AS COUNT
      FROM STUDENT_GROUP_FEES
      WHERE STUDENT_ID = :studentId
        AND GROUP_ID = :groupId
        AND FEE_YEAR = :year
        AND FEE_MONTH = :month
      `,
      { studentId, groupId, year, month },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const exists = checkResult.rows[0].COUNT > 0;

    if (exists) {
      await connection.execute(
        `
        UPDATE STUDENT_GROUP_FEES
        SET AMOUNT_PAID = :amountPaid,
            IS_PAID    = :isPaid,
            CREATED_AT = TO_DATE(:createdAt, 'YYYY-MM-DD HH24:MI:SS')
        WHERE STUDENT_ID = :studentId
          AND GROUP_ID   = :groupId
          AND FEE_YEAR   = :year
          AND FEE_MONTH  = :month
        `,
        { studentId, groupId, year, month, amountPaid, isPaid, createdAt },
        { autoCommit: true }
      );
    } else {
      await connection.execute(
        `
        INSERT INTO STUDENT_GROUP_FEES
        (
          STUDENT_ID,
          GROUP_ID,
          FEE_YEAR,
          FEE_MONTH,
          IS_PAID,
          AMOUNT_PAID,
          CREATED_AT
        )
        VALUES (
          :studentId,
          :groupId,
          :year,
          :month,
          :isPaid,
          :amountPaid,
          TO_DATE(:createdAt, 'YYYY-MM-DD HH24:MI:SS')
        )
        `,
        { studentId, groupId, year, month, amountPaid, isPaid, createdAt },
        { autoCommit: true }
      );
    }

    await connection.close();
    res.status(200).json({ success: true });

  } catch (err) {
    console.error('Error updating student payment:', err);
    res.status(500).json({ error: err.message });
  }
});



app.get('/api/teacher/schedule', async (req, res) => {
  const { teacherId } = req.query;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(`
      SELECT
        S.SCHEDULE_ID,
        G.NAME AS GROUP_NAME,
        R.NAME AS ROOM_NAME,
        DAY,
        TO_CHAR(S.START_TIME,'HH24:MI') AS START_TIME,
        TO_CHAR(S.END_TIME,'HH24:MI') AS END_TIME
      FROM SCHEDULE S
      JOIN GROUPS G ON G.GROUP_ID = S.GROUP_ID
      JOIN ROOMS R ON R.ROOM_ID = S.ROOM_ID
      WHERE G.TEACHER_ID = :TEACHER_ID
      ORDER BY S.START_TIME
    `, {
      TEACHER_ID: Number(teacherId),
    });

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});



app.get('/api/schedule/:id/students', async (req, res) => {
  const { id } = req.params;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(`
      SELECT
        ST.STUDENT_ID,
        ST.NAME
      FROM SCHEDULE S
      JOIN GROUP_STUDENTS GS ON GS.GROUP_ID = S.GROUP_ID
      JOIN STUDENTS ST ON ST.STUDENT_ID = GS.STUDENT_ID
      WHERE S.SCHEDULE_ID = :id
      ORDER BY ST.NAME
    `, { id });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});

app.get('/api/schedule/:scheduleId/notes', async (req, res) => {
  const { scheduleId } = req.params;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      `SELECT 
        SN.NOTE_TEXT,
        SN.RATING,        -- أضفنا جلب التقييم
        SN.STUDENT_ID,    -- أضفنا جلب معرف الطالب للربط
        TO_CHAR(SN.NOTE_DATE, 'YYYY-MM-DD') AS NOTE_DATE,
        S.NAME AS STUDENT_NAME
      FROM STUDENT_NOTES SN
      JOIN STUDENTS S ON SN.STUDENT_ID = S.STUDENT_ID
      WHERE SN.SCHEDULE_ID = :schid
      ORDER BY SN.NOTE_DATE DESC`,
      { schid: Number(scheduleId) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchInfo: { "NOTE_TEXT": { type: oracledb.STRING } } }
    );

    res.json(result.rows); 
  } catch (err) {
    console.error("Oracle Error:", err);
    res.status(500).json({ message: err.message, code: err.errorNum ?? null });
  } finally {
    if (conn) await conn.close();
  }
});

app.post('/api/attendance', async (req, res) => {
  // استخدام destructuring مع التأكد من النوع
  const scheduleId = Number(req.body.scheduleId);
  const studentId = Number(req.body.studentId);
  const { status, attendanceDate } = req.body;

  // التحقق من أن الأرقام صالحة
  if (isNaN(scheduleId) || isNaN(studentId)) {
    return res.status(400).json({ error: "Invalid ID: value is NaN" });
  }

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    await conn.execute(`
      MERGE INTO ATTENDANCE T
      USING (SELECT :sid as s_id, :st_id as st_id, TO_DATE(:a_date, 'YYYY-MM-DD') as a_date FROM DUAL) S
      ON (T.SCHEDULE_ID = S.s_id AND T.STUDENT_ID = S.st_id AND T.ATTENDANCE_DATE = S.a_date)
      WHEN MATCHED THEN
        UPDATE SET STATUS = :status
      WHEN NOT MATCHED THEN
        INSERT (SCHEDULE_ID, STUDENT_ID, ATTENDANCE_DATE, STATUS)
        VALUES (S.s_id, S.st_id, S.a_date, :status)
    `, {
      sid: scheduleId,
      st_id: studentId,
      a_date: attendanceDate,
      status: status
    });

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});
app.post('/api/student/:studentId/note', async (req, res) => {
  const { studentId } = req.params;
  const { scheduleId, note, noteDate, rating } = req.body;

  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    
    // التعديل هنا: استخدام DBMS_LOB.COMPARE أو تحويل النوع في المقارنة
    await conn.execute(`
    MERGE INTO STUDENT_NOTES T
    USING (
      SELECT 
        :st_id as st_id,
        :sch_id as sch_id,
        TO_DATE(:n_date, 'YYYY-MM-DD') as n_date
      FROM DUAL
    ) S
    ON (
      T.STUDENT_ID = S.st_id 
      AND T.SCHEDULE_ID = S.sch_id 
      AND T.NOTE_DATE = S.n_date
    )
    WHEN MATCHED THEN
      UPDATE SET T.RATING = :rating, T.NOTE_TEXT = :note_val
    WHEN NOT MATCHED THEN
      INSERT (STUDENT_ID, SCHEDULE_ID, NOTE_DATE, NOTE_TEXT, RATING)
      VALUES (:st_id, :sch_id, TO_DATE(:n_date, 'YYYY-MM-DD'), :note_val, :rating)
  `, {
    st_id: parseInt(studentId),
    sch_id: parseInt(scheduleId),
    n_date: noteDate,
    note_val: note,
    rating: parseInt(rating)
  });
  

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    console.error("Database Error Detail:", err);
    res.status(500).json({ message: err.message });
  } finally {
    if (conn) await conn.close();
  }
});


app.get('/api/teacher/:teacherId/day-summary', async (req, res) => {
  const { teacherId } = req.params;
  const { date } = req.query;
  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    const result = await conn.execute(`
      SELECT 
        SUM(CASE WHEN A.STATUS IN ('present', 'late') THEN 1 ELSE 0 END) as PRESENT_COUNT,
        SUM(CASE WHEN A.STATUS = 'absent' THEN 1 ELSE 0 END) as ABSENT_COUNT
      FROM ATTENDANCE A
      JOIN SCHEDULE S ON A.SCHEDULE_ID = S.SCHEDULE_ID
      JOIN GROUPS G ON S.GROUP_ID = G.GROUP_ID
      WHERE G.TEACHER_ID = :teacherId 
      AND A.ATTENDANCE_DATE = TO_DATE(:attDate, 'YYYY-MM-DD')
    `, { teacherId, attDate: date }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json({
      presentCount: result.rows[0].PRESENT_COUNT || 0,
      absentCount: result.rows[0].ABSENT_COUNT || 0
    });
  } catch (err) {
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});

app.get('/api/student/:studentId/report/summary', async (req, res) => {
  const { studentId } = req.params;
  let conn;
  try {
    conn = await oracledb.getConnection(dbConfig);
    
    const result = await conn.execute(`
      SELECT 
        ST.NAME,
        (SELECT COUNT(*) FROM ATTENDANCE WHERE STUDENT_ID = ST.STUDENT_ID AND STATUS = 'present') as PRESENCE_DAYS,
        (SELECT COUNT(*) FROM ATTENDANCE WHERE STUDENT_ID = ST.STUDENT_ID AND STATUS = 'absent') as ABSENCE_DAYS,
        (SELECT COUNT(*) FROM ATTENDANCE WHERE STUDENT_ID = ST.STUDENT_ID AND STATUS = 'late') as LATE_DAYS,
        (SELECT COUNT(*) FROM STUDENT_NOTES WHERE STUDENT_ID = ST.STUDENT_ID) as TOTAL_NOTES
      FROM STUDENTS ST
      WHERE ST.STUDENT_ID = :id
    `, { id: Number(studentId) }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});


app.get('/api/student/:studentId/report', async (req, res) => {
  const { studentId } = req.params;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(
      `
      SELECT 
      G.GROUP_ID,
      G.NAME AS GROUP_NAME,
    
      COUNT(SN.RATING) AS RATINGS_COUNT,
      ROUND(AVG(SN.RATING), 2) AS AVG_RATING,
    
      -- ملاحظات آخر 30 يوم
      LISTAGG(
        TO_CHAR(SN.NOTE_DATE, 'YYYY-MM-DD') || ' : ' ||
        DBMS_LOB.SUBSTR(SN.NOTE_TEXT, 200, 1),
        CHR(10)
      ) WITHIN GROUP (ORDER BY SN.NOTE_DATE DESC) AS NOTES,
    
      -- Attendance counts
      SUM(CASE WHEN A.STATUS = 'present' THEN 1 ELSE 0 END) AS PRESENT_COUNT,
      SUM(CASE WHEN A.STATUS = 'late'    THEN 1 ELSE 0 END) AS LATE_COUNT,
      SUM(CASE WHEN A.STATUS = 'absent'  THEN 1 ELSE 0 END) AS ABSENT_COUNT
    
    FROM STUDENT_NOTES SN
    JOIN SCHEDULE S       ON SN.SCHEDULE_ID = S.SCHEDULE_ID
    JOIN GROUPS G         ON S.GROUP_ID = G.GROUP_ID
    
    LEFT JOIN ATTENDANCE A
      ON A.STUDENT_ID = SN.STUDENT_ID
     AND A.SCHEDULE_ID = S.SCHEDULE_ID
     AND A.ATTENDANCE_DATE >= TRUNC(SYSDATE) - 30
    
    WHERE SN.STUDENT_ID = :studentId
      AND SN.NOTE_DATE >= TRUNC(SYSDATE) - 30
    
    GROUP BY G.GROUP_ID, G.NAME
    ORDER BY G.NAME
    
    
      `,
      { studentId: Number(studentId) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    

    const rows = (result.rows || []).map(r => {
      return {
        ...r,
        NOTES: r.NOTES
          ? r.NOTES.split('\n').filter(note => !note.includes('تقييم سريع')).join('\n')
          : ''
      };
    });
    
    // التقييم العام (ما زال يشمل كل الملاحظات بما فيها التقييم السريع إذا تريد)
    const overall = rows.reduce((acc, g) => acc + (g.AVG_RATING || 0), 0);
    const overallRating = rows.length ? +(overall / rows.length).toFixed(2) : 0;

    res.json({
      studentId: Number(studentId),
      overallRating,
      groups: rows
    });
    

  } catch (err) {
    console.error("Error fetching student report:", err);
    res.status(500).json({ message: err.message, error: err });
  } finally {
    if (conn) await conn.close();
  }
});
app.get('/api/student/:studentId/report/attendance-summary', async (req, res) => {
  const { studentId } = req.params;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);

    const result = await conn.execute(`
      SELECT
        SUM(CASE WHEN STATUS = 'present' THEN 1 ELSE 0 END) AS PRESENT_COUNT,
        SUM(CASE WHEN STATUS = 'absent'  THEN 1 ELSE 0 END) AS ABSENT_COUNT,
        SUM(CASE WHEN STATUS = 'late'    THEN 1 ELSE 0 END) AS LATE_COUNT
      FROM ATTENDANCE
      WHERE STUDENT_ID = :studentId
        AND ATTENDANCE_DATE >= TRUNC(SYSDATE) - 30
    `, {
      studentId: Number(studentId)
    }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});



app.get('/api/attendance', async (req, res) => {
  const { scheduleId, attendanceDate } = req.query;
  let conn;

  try {
    conn = await oracledb.getConnection(dbConfig);
    const result = await conn.execute(`
      SELECT STUDENT_ID, STATUS 
      FROM ATTENDANCE 
      WHERE SCHEDULE_ID = :sid 
      AND ATTENDANCE_DATE = TO_DATE(:adate, 'YYYY-MM-DD')
    `, { 
      sid: Number(scheduleId), 
      adate: attendanceDate 
    }, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err);
  } finally {
    if (conn) await conn.close();
  }
});
app.get('/api/teacher/:teacherId/students',async(req,res)=>{
const {teacherId} = req.params
try{
  conn=await oracledb.getConnection(dbConfig);
  const result = await conn.execute(`
  SELECT COUNT(DISTINCT GS.STUDENT_ID) AS TOTAL_STUDENTS
  FROM GROUP_STUDENTS GS
  JOIN GROUPS G ON G.GROUP_ID = GS.GROUP_ID
  WHERE G.TEACHER_ID = :teacherId`,{teacherId})
  res.json(result.rows)

}
catch(err){
res.status(500).json(err);

}finally{
  if(conn) await conn.close()
}
});
// حفظ أو تحديث حضور الطالب
app.post('/api/change-teacher-image', async (req, res) => {
  const { TEACHER_ID, IMAGE_URL } = req.body;

  // 1️⃣ التحقق من البيانات
  if (!TEACHER_ID || !IMAGE_URL) {
    return res.status(400).json({ error: 'TEACHER_ID و IMAGE_URL مطلوبين' });
  }

  // (اختياري) تحقق من مصدر الصورة
  if (!IMAGE_URL.startsWith('https://res.cloudinary.com/')) {
    return res.status(400).json({ error: 'رابط الصورة غير صالح' });
  }

  let connection;

  try {
    connection = await oracledb.getConnection(dbConfig);

    // 2️⃣ التأكد من وجود المدرس
    const result = await connection.execute(
      `SELECT TEACHER_ID FROM TEACHERS WHERE TEACHER_ID = :TEACHER_ID`,
      { TEACHER_ID },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'المدرس غير موجود' });
    }

    // 3️⃣ تحديث الصورة
    await connection.execute(
      `
      UPDATE TEACHERS
      SET IMAGE = :IMAGE_URL
      WHERE TEACHER_ID = :TEACHER_ID
      `,
      { IMAGE_URL, TEACHER_ID },
      { autoCommit: true }
    );

    res.json({ message: 'تم تحديث صورة المدرس بنجاح ✅' });

  } catch (err) {
    console.error('❌ Error changing teacher image:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث صورة المدرس' });
  } finally {
    if (connection) await connection.close();
  }
});

app.get('/api/admin/teachers/:id', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await oracledb.getConnection(dbConfig);
    const result = await connection.execute(
      `SELECT TEACHER_ID, FIRST_NAME, LAST_NAME, PHONE_NUMBER, GENDER, IMAGE, SUBJECT, GOLDEN, YOUTUBE_URL
       FROM TEACHERS
       WHERE TEACHER_ID = :id`,
      { id: Number(id) },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب بيانات المدرس' });
  } finally {
    if (connection) await connection.close();
  }
});


app.listen(PORT, '0.0.0.0', () => {
   console.log(`🚀 Server running on http://192.168.1.111:${PORT});`)
  });
