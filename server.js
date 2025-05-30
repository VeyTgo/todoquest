// unemployment-quest-backend/server.js

// Import modul yang diperlukan
require('dotenv').config(); // Untuk memuat variabel lingkungan dari file .env
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb'); // ObjectId untuk query berdasarkan _id
const cors = require('cors'); // Untuk mengizinkan Cross-Origin Resource Sharing
const bcrypt = require('bcryptjs'); // Untuk hashing password
const jwt = require('jsonwebtoken'); // Untuk JSON Web Tokens (autentikasi)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Untuk fetch API di Node.js (seperti timeapi)

// Inisialisasi aplikasi Express
const app = express();
const port = process.env.PORT || 3001; // Port untuk backend API, default 3001

// --- Konfigurasi MongoDB ---
// Ambil URI MongoDB dari variabel lingkungan. Ganti 'unemploymentQuestDB' dengan nama database Anda jika berbeda.
const mongoUri = process.env.MONGODB_URI || "mongodb+srv://kagetest:37r16Z6I3FENQgTd@cluster0.xpl7cqn.mongodb.net/unemploymentQuestDB?retryWrites=true&w=majority&appName=Cluster0";
const jwtSecret = process.env.JWT_SECRET || "INI_RAHASIA_SUPER_AMAN_HARUS_DIGANTI_DI_ENV"; // Ganti dengan secret yang kuat di .env

if (!mongoUri.includes('unemploymentQuestDB')) { // Pastikan nama database ada di URI
    console.warn("Nama database 'unemploymentQuestDB' tidak ada di MONGODB_URI. Menggunakan default dari URI.");
}
if (jwtSecret === "INI_RAHASIA_SUPER_AMAN_HARUS_DIGANTI_DI_ENV") {
    console.warn("PERINGATAN: JWT_SECRET masih menggunakan nilai default. Harap ganti di file .env untuk keamanan produksi!");
}

const client = new MongoClient(mongoUri);
let db; // Variabel untuk menyimpan instance database

// --- Middleware ---
app.use(cors()); // Mengaktifkan CORS untuk semua rute
app.use(express.json()); // Mem-parse request body JSON

// --- Fungsi untuk koneksi ke Database ---
async function connectDB() {
    try {
        await client.connect();
        // Tentukan nama database di sini jika belum ada di URI atau ingin override
        db = client.db("unemploymentQuestDB"); // Eksplisit menggunakan nama database
        console.log("Berhasil terhubung ke MongoDB Atlas");
    } catch (err) {
        console.error("Gagal terhubung ke MongoDB:", err);
        process.exit(1); // Keluar dari aplikasi jika koneksi DB gagal
    }
}

// --- Middleware untuk Autentikasi Token JWT ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer TOKEN

    if (token == null) {
        return res.status(401).json({ message: "Akses ditolak. Token tidak disediakan." });
    }

    jwt.verify(token, jwtSecret, (err, user) => {
        if (err) {
            console.error("JWT Verify Error:", err.message);
            return res.status(403).json({ message: "Token tidak valid atau kedaluwarsa." });
        }
        req.user = user; // Menyimpan payload user dari token ke objek request
        next(); // Lanjutkan ke handler rute berikutnya
    });
}

// --- Rute API ---

// == AUTHENTICATION ==
app.post('/api/auth/signup', async (req, res) => {
    const { username, password } = req.body;
    // Membuat email unik (opsional, bisa disesuaikan jika tidak ingin format email)
    const emailForAuth = `${username.toLowerCase().replace(/\s+/g, '_')}@questapp.local`;

    if (!username || !password) {
        return res.status(400).json({ message: "Username dan password diperlukan." });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: "Password minimal 6 karakter." });
    }

    try {
        const existingUser = await db.collection('users').findOne({ $or: [{ username: username.toLowerCase() }, { emailForAuth }] });
        if (existingUser) {
            return res.status(400).json({ message: "Username atau email sudah digunakan." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const counterUpdateResult = await db.collection('appCounters').findOneAndUpdate(
            { _id: "playerCounter" },
            { $inc: { count: 1 } },
            { returnDocument: 'after', upsert: true }
        );
        const customPlayerId = counterUpdateResult.value ? counterUpdateResult.value.count : 1;

        const newUser = {
            username: username.toLowerCase(), // Simpan username dalam lowercase untuk konsistensi
            originalUsername: username, // Simpan username asli untuk tampilan
            emailForAuth,
            hashedPassword,
            displayName: username,
            xp: 0,
            level: 1,
            dailyStreak: 0,
            lastStreakUpdateDate: null,
            daysCompletedThisCycle: 0,
            profilePicture: null,
            bio: "Petualang pemberani!",
            customPlayerId,
            createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(newUser);
        const userForToken = { userId: result.insertedId.toString(), username: newUser.username };
        const accessToken = jwt.sign(userForToken, jwtSecret, { expiresIn: '24h' }); // Token berlaku 24 jam

        res.status(201).json({
            message: "User berhasil dibuat!",
            accessToken,
            user: { // Kirim data user yang relevan
                _id: result.insertedId,
                displayName: newUser.displayName,
                customPlayerId: newUser.customPlayerId,
                xp: newUser.xp,
                level: newUser.level,
                dailyStreak: newUser.dailyStreak,
                lastStreakUpdateDate: newUser.lastStreakUpdateDate,
                daysCompletedThisCycle: newUser.daysCompletedThisCycle,
                profilePicture: newUser.profilePicture,
                bio: newUser.bio,
            }
        });
    } catch (error) {
        console.error("Signup error:", error);
        res.status(500).json({ message: "Terjadi kesalahan pada server saat signup." });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const emailForAuth = `${username.toLowerCase().replace(/\s+/g, '_')}@questapp.local`;

    if (!username || !password) {
        return res.status(400).json({ message: "Username dan password diperlukan." });
    }

    try {
        const user = await db.collection('users').findOne({ $or: [{ username: username.toLowerCase() }, { emailForAuth }] });
        if (!user) {
            return res.status(401).json({ message: "Username atau password salah." });
        }

        const isMatch = await bcrypt.compare(password, user.hashedPassword);
        if (!isMatch) {
            return res.status(401).json({ message: "Username atau password salah." });
        }

        const userForToken = { userId: user._id.toString(), username: user.username };
        const accessToken = jwt.sign(userForToken, jwtSecret, { expiresIn: '24h' });

        const { hashedPassword, ...userProfile } = user; // Hapus hashedPassword dari response

        res.json({
            message: "Login berhasil!",
            accessToken,
            user: userProfile
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Terjadi kesalahan pada server saat login." });
    }
});


// == USER PROFILE & STATE ==
app.get('/api/user/state', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(userId) },
            { projection: { hashedPassword: 0, emailForAuth: 0 } } // Jangan kirim field sensitif
        );
        if (!user) {
            return res.status(404).json({ message: "User tidak ditemukan." });
        }
        res.json(user);
    } catch (error) {
        console.error("Get user state error:", error);
        res.status(500).json({ message: "Gagal mengambil data user." });
    }
});

app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { displayName, bio, profilePicture } = req.body;
    const userId = req.user.userId;

    try {
        const updateData = {};
        if (displayName !== undefined) updateData.displayName = displayName;
        if (bio !== undefined) updateData.bio = bio;
        if (profilePicture !== undefined) updateData.profilePicture = profilePicture; // Simpan URL

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ message: "Tidak ada data untuk diupdate." });
        }

        const result = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(userId) },
            { $set: updateData },
            { returnDocument: 'after', projection: { hashedPassword: 0, emailForAuth: 0 } }
        );

        if (!result.value) {
            return res.status(404).json({ message: "User tidak ditemukan." });
        }
        res.json({ message: "Profil berhasil diupdate.", user: result.value });
    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ message: "Gagal update profil." });
    }
});


// == QUESTS ==
app.post('/api/quests', authenticateToken, async (req, res) => {
    const { name, xp, type } = req.body;
    const userId = req.user.userId;

    if (!name || xp === undefined || !type) {
        return res.status(400).json({ message: "Nama, XP, dan tipe quest diperlukan."});
    }
    if (isNaN(parseInt(xp)) || parseInt(xp) <=0) {
        return res.status(400).json({ message: "XP harus angka positif."});
    }

    let currentJakartaDateForQuest = null;
    if (type === "daily") {
        try {
            const timeApiResponse = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FJakarta');
            if (timeApiResponse.ok) {
                const timeApiData = await timeApiResponse.json();
                currentJakartaDateForQuest = timeApiData.date; // "YYYY-MM-DD"
            }
        } catch (e) { console.warn("Gagal fetch timeapi untuk quest daily baru, lastResetDate mungkin null:", e); }
    }

    const newQuest = {
        userId: new ObjectId(userId),
        name,
        xp: parseInt(xp),
        type,
        isCompleted: false,
        createdAt: new Date(),
        completedAt: null,
        lastResetDate: type === "daily" ? currentJakartaDateForQuest : null
    };

    try {
        const result = await db.collection('quests').insertOne(newQuest);
        res.status(201).json({ ...newQuest, _id: result.insertedId });
    } catch (error) {
        console.error("Add quest error:", error);
        res.status(500).json({ message: "Gagal menambah quest." });
    }
});

app.get('/api/quests', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const quests = await db.collection('quests').find({ userId: new ObjectId(userId) }).sort({ createdAt: -1 }).toArray(); // Urutkan terbaru dulu
        res.json(quests);
    } catch (error) {
        console.error("Get quests error:", error);
        res.status(500).json({ message: "Gagal mengambil quests." });
    }
});

app.put('/api/quests/:questId/toggle', authenticateToken, async (req, res) => {
    const { questId } = req.params;
    const userId = req.user.userId;
    const XP_PER_LEVEL = 100; // Definisikan konstanta XP per level

    try {
        const quest = await db.collection('quests').findOne({ _id: new ObjectId(questId), userId: new ObjectId(userId) });
        if (!quest) {
            return res.status(404).json({ message: "Quest tidak ditemukan atau Anda tidak berhak." });
        }

        const newCompletedStatus = !quest.isCompleted;
        await db.collection('quests').updateOne(
            { _id: new ObjectId(questId) },
            { $set: { isCompleted: newCompletedStatus, completedAt: newCompletedStatus ? new Date() : null } }
        );

        // Update XP, Level, dan Streak User
        const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ message: "User tidak ditemukan saat update XP."});

        let { xp, level, dailyStreak, lastStreakUpdateDate, daysCompletedThisCycle } = user;

        if (newCompletedStatus) {
            xp += quest.xp;
        } else {
            xp = Math.max(0, xp - quest.xp); // Cegah XP negatif
        }

        while (xp >= XP_PER_LEVEL) {
            xp -= XP_PER_LEVEL;
            level++;
        }

        if (newCompletedStatus) { // Hanya update streak jika quest DISELESAIKAN
            let currentJakartaDate;
            try {
                const timeResponse = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FJakarta');
                if (timeResponse.ok) {
                    const timeData = await timeResponse.json();
                    currentJakartaDate = timeData.date; // "YYYY-MM-DD"

                    if (lastStreakUpdateDate !== currentJakartaDate) { // Hari baru atau streak pertama
                        let streakBroken = false;
                        if (lastStreakUpdateDate) {
                            const yesterday = new Date(currentJakartaDate);
                            yesterday.setDate(yesterday.getDate() - 1);
                            if (lastStreakUpdateDate !== yesterday.toISOString().split('T')[0]) {
                                streakBroken = true;
                            }
                        }
                        if (streakBroken) {
                            dailyStreak = 0;
                            daysCompletedThisCycle = 0;
                        }
                        dailyStreak++;
                        daysCompletedThisCycle = (dailyStreak - 1) % 7 + 1;
                        lastStreakUpdateDate = currentJakartaDate;
                    }
                    // Jika lastStreakUpdateDate SAMA dengan currentJakartaDate, berarti sudah ada quest lain yang diselesaikan hari ini, streak sudah dihitung.
                } else {
                    console.warn("Gagal fetch time untuk update streak, streak mungkin tidak akurat.");
                }
            } catch (e) { console.warn("Error fetching time for streak:", e); }
        }

        const updateResult = await db.collection('users').findOneAndUpdate(
            { _id: new ObjectId(userId) },
            { $set: { xp, level, dailyStreak, lastStreakUpdateDate, daysCompletedThisCycle }},
            { returnDocument: 'after', projection: { hashedPassword: 0, emailForAuth: 0 } }
        );

        res.json({
            message: "Status quest diupdate.",
            updatedQuest: { ...quest, isCompleted: newCompletedStatus, completedAt: newCompletedStatus ? new Date() : null },
            updatedUser: updateResult.value
        });

    } catch (error) {
        console.error("Toggle quest error:", error);
        res.status(500).json({ message: "Gagal update status quest." });
    }
});

app.delete('/api/quests/:questId', authenticateToken, async (req, res) => {
    const { questId } = req.params;
    const userId = req.user.userId;
    try {
        const result = await db.collection('quests').deleteOne({ _id: new ObjectId(questId), userId: new ObjectId(userId) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Quest tidak ditemukan atau Anda tidak berhak menghapusnya." });
        }
        res.status(200).json({ message: "Quest berhasil dihapus." });
    } catch (error) {
        console.error("Delete quest error:", error);
        res.status(500).json({ message: "Gagal menghapus quest." });
    }
});

// == SYSTEM ==
// Endpoint ini bisa dipanggil oleh cron job atau oleh client sekali sehari
app.post('/api/system/daily-reset', async (req, res) => {
    let currentJakartaDate;
    try {
        const timeResponse = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FJakarta');
        if (!timeResponse.ok) throw new Error("Gagal mengambil waktu dari timeapi.io");
        const timeData = await timeResponse.json();
        currentJakartaDate = timeData.date;
    } catch (e) {
        console.error("Error fetching time for daily reset:", e.message);
        return res.status(500).json({ message: "Gagal mendapatkan waktu saat ini untuk reset." });
    }

    try {
        // 1. Reset Daily Quests
        const dailyQuestsUpdateResult = await db.collection('quests').updateMany(
            { type: "daily", $or: [{ lastResetDate: { $ne: currentJakartaDate } }, { lastResetDate: null }] },
            { $set: { isCompleted: false, lastResetDate: currentJakartaDate } }
        );

        // 2. Update Streaks for users who haven't completed a quest today and whose last update was not yesterday
        const usersCursor = db.collection('users').find({}); // Iterasi semua user
        let streaksBrokenCount = 0;
        for await (const user of usersCursor) {
            if (user.lastStreakUpdateDate && user.lastStreakUpdateDate !== currentJakartaDate) {
                const yesterday = new Date(currentJakartaDate);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = yesterday.toISOString().split('T')[0];

                if (user.lastStreakUpdateDate !== yesterdayStr) {
                    // Streak patah
                    await db.collection('users').updateOne(
                        { _id: user._id },
                        { $set: { dailyStreak: 0, daysCompletedThisCycle: 0 } }
                    );
                    streaksBrokenCount++;
                }
            }
        }

        res.json({
            message: "Proses harian selesai.",
            dailyQuestsReset: dailyQuestsUpdateResult.modifiedCount,
            streaksCheckedAndPotentiallyBroken: streaksBrokenCount
        });

    } catch (error) {
        console.error("Daily reset process error:", error);
        res.status(500).json({ message: "Gagal melakukan proses harian." });
    }
});


// --- Mulai Server ---
async function startServer() {
    await connectDB(); // Pastikan DB terkoneksi sebelum server jalan
    app.listen(port, () => {
        console.log(`Backend API Unemployment's Quest berjalan di http://localhost:${port}`);
    });
}

startServer();