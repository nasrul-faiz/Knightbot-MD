const express = require('express')
const fs = require('fs')
const path = require('path')
const multer = require('multer')

const app = express()
const PORT = process.env.PORT || 5000

const uploadsDir = path.join(__dirname, 'public', 'uploads')
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || ''
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
    }
})
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// In-memory log buffer (shared with bot via global)
if (!global.dashboardLogs) global.dashboardLogs = []

// Intercept console.log/error for logs
const originalLog = console.log
const originalError = console.error
// Noise patterns to suppress from dashboard logs (still print to terminal)
const LOG_SUPPRESS = [
    /Failed to decrypt message/i,
    /doDecryptWhisperMessage/i,
    /verifyMAC/i,
    /session_cipher/i,
    /Closing session/i,
    /Removing old closed session/i,
    /pendingPreKey/i,
    /ephemeralKeyPair/i,
    /lastRemoteEphemeralKey/i,
    /registrationId/i,
    /baseKeyType/i,
]
function isSuppressed(msg) { return LOG_SUPPRESS.some(re => re.test(msg)) }

function addLog(level, args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (isSuppressed(msg)) return
    global.dashboardLogs.push({ time: Date.now(), level, msg })
    if (global.dashboardLogs.length > 200) global.dashboardLogs.shift()
}
console.log = (...args) => { addLog('info', args); originalLog(...args) }
console.error = (...args) => { addLog('error', args); originalError(...args) }

// ── Helper: safe JSON read ──────────────────────────────────────────────────
function readJSON(filePath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
        return fallback
    }
}

// ── API: Bot status ─────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
    const creds = readJSON('./session/creds.json')
    const settings = readJSON('./settings.json') || require('./settings')
    const banned = readJSON('./data/banned.json', [])
    const premium = readJSON('./data/premium.json', [])
    const warnings = readJSON('./data/warnings.json', {})
    const messageCount = readJSON('./data/messageCount.json', {})

    const connected = !!(creds && creds.me && creds.registered)
    const account = creds?.me || null
    const botInfo = readJSON('./data/botInfo.json', {})

    const totalMessages = Object.values(messageCount).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
    const warningCount = Object.keys(warnings).length

    res.json({
        connected,
        account,
        profilePic: botInfo.profilePic || null,
        uptime: process.uptime(),
        version: settings.version || '3.0.7',
        botName: settings.botName || 'Knight Bot',
        commandMode: settings.commandMode || 'public',
        ownerNumber: settings.ownerNumber || '',
        stats: {
            banned: Array.isArray(banned) ? banned.length : Object.keys(banned).length,
            premium: Array.isArray(premium) ? premium.length : Object.keys(premium).length,
            warnings: warningCount,
            messages: totalMessages,
        }
    })
})

// ── API: Logs ───────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
    res.json(global.dashboardLogs.slice(-100).reverse())
})

// ── API: Settings GET ───────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
    const settings = require('./settings')
    res.json({
        botName: settings.botName,
        botOwner: settings.botOwner,
        ownerNumber: settings.ownerNumber,
        commandMode: settings.commandMode,
        packname: settings.packname,
        author: settings.author,
        description: settings.description,
        version: settings.version,
    })
})

// ── API: Settings POST ──────────────────────────────────────────────────────
app.post('/api/settings', (req, res) => {
    try {
        const { botName, botOwner, ownerNumber, commandMode, packname, description } = req.body
        const settingsPath = path.join(__dirname, 'settings.js')
        let content = fs.readFileSync(settingsPath, 'utf8')

        const replace = (key, value) => {
            const escaped = value.replace(/'/g, "\\'")
            content = content.replace(
                new RegExp(`(${key}:\\s*")[^"]*(")|( ${key}:\\s*')[^']*(')`),
                (match) => match.replace(/'[^']*'|"[^"]*"/, `'${escaped}'`)
            )
        }

        if (botName !== undefined) replace('botName', botName)
        if (botOwner !== undefined) replace('botOwner', botOwner)
        if (ownerNumber !== undefined) replace('ownerNumber', ownerNumber)
        if (commandMode !== undefined) replace('commandMode', commandMode)
        if (packname !== undefined) replace('packname', packname)
        if (description !== undefined) replace('description', description)

        fs.writeFileSync(settingsPath, content, 'utf8')

        // Reload settings module
        delete require.cache[require.resolve('./settings')]

        res.json({ success: true, message: 'Settings saved! Restart the bot for full effect.' })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Features state ─────────────────────────────────────────────────────
app.get('/api/features', (req, res) => {
    const autoStatus = readJSON('./data/autoStatus.json', { enabled: false })
    const autoRead = readJSON('./data/autoread.json', { enabled: false })
    const autoTyping = readJSON('./data/autotyping.json', { enabled: false })
    const antiDelete = readJSON('./data/antidelete.json', { enabled: false })

    res.json({
        autoStatus: autoStatus.enabled || false,
        autoRead: autoRead.enabled || false,
        autoTyping: autoTyping.enabled || false,
        antiDelete: antiDelete.enabled || false,
    })
})

// ── API: Banned users ───────────────────────────────────────────────────────
app.get('/api/banned', (req, res) => {
    const banned = readJSON('./data/banned.json', [])
    res.json(Array.isArray(banned) ? banned : Object.keys(banned))
})

// ── API: QR Code state ──────────────────────────────────────────────────────
app.get('/api/session/qr', (req, res) => {
    const qrState = readJSON('./data/qrState.json', { status: 'unknown' })
    res.json(qrState)
})

// ── API: Session reset (delete session → bot will regenerate QR) ────────────
app.post('/api/session/reset', (req, res) => {
    try {
        const sessionDir = path.join(__dirname, 'session')
        if (fs.existsSync(sessionDir)) {
            fs.readdirSync(sessionDir).forEach(f => {
                try { fs.unlinkSync(path.join(sessionDir, f)) } catch (_) {}
            })
        }
        try { fs.writeFileSync('./data/qrState.json', JSON.stringify({ status: 'resetting', timestamp: Date.now() })) } catch (_) {}
        try { fs.writeFileSync('./data/botInfo.json', JSON.stringify({})) } catch (_) {}
        res.json({ success: true, message: 'Session cleared. Bot will show QR code shortly.' })
        setTimeout(() => process.exit(1), 500)
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Media upload ────────────────────────────────────────────────────────
app.post('/api/upload-media', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded.' })
        const url = `/uploads/${req.file.filename}`
        res.json({ success: true, url, originalName: req.file.originalname, size: req.file.size })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Custom Commands GET ─────────────────────────────────────────────────
app.get('/api/custom-commands', (req, res) => {
    const cmds = readJSON('./data/customCommands.json', [])
    res.json(Array.isArray(cmds) ? cmds : [])
})

// ── API: Custom Commands POST (add) ──────────────────────────────────────────
app.post('/api/custom-commands', (req, res) => {
    try {
        const { trigger, response, description, mediaUrl, mediaType, fileName } = req.body
        if (!trigger) return res.status(400).json({ success: false, error: 'Trigger is required.' })
        if (!response && !mediaUrl) return res.status(400).json({ success: false, error: 'At least a response text or media URL is required.' })

        const clean = trigger.trim().toLowerCase().replace(/\s+/g, '')
        if (!clean.startsWith('.')) return res.status(400).json({ success: false, error: 'Trigger must start with a dot (e.g. .hello)' })

        const cmds = readJSON('./data/customCommands.json', [])
        if (cmds.find(c => c.trigger === clean)) return res.status(409).json({ success: false, error: `Command ${clean} already exists.` })

        const entry = { trigger: clean, response: (response || '').trim(), description: (description || '').trim() }
        if (mediaUrl && mediaUrl.trim()) { entry.mediaUrl = mediaUrl.trim(); entry.mediaType = (mediaType || 'image').trim() }
        if (fileName && fileName.trim()) entry.fileName = fileName.trim()
        cmds.push(entry)
        fs.writeFileSync('./data/customCommands.json', JSON.stringify(cmds, null, 2))
        res.json({ success: true, message: `Command ${clean} added!` })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Custom Commands PUT (edit) ──────────────────────────────────────────
app.put('/api/custom-commands/:trigger', (req, res) => {
    try {
        const key = decodeURIComponent(req.params.trigger).toLowerCase()
        const { response, description, mediaUrl, mediaType, fileName } = req.body
        if (!response && !mediaUrl) return res.status(400).json({ success: false, error: 'At least a response text or media URL is required.' })

        const cmds = readJSON('./data/customCommands.json', [])
        const idx = cmds.findIndex(c => c.trigger === key)
        if (idx === -1) return res.status(404).json({ success: false, error: 'Command not found.' })

        cmds[idx].response = (response || '').trim()
        cmds[idx].description = (description || '').trim()
        if (mediaUrl && mediaUrl.trim()) { cmds[idx].mediaUrl = mediaUrl.trim(); cmds[idx].mediaType = (mediaType || 'image').trim() }
        else { delete cmds[idx].mediaUrl; delete cmds[idx].mediaType }
        if (fileName && fileName.trim()) cmds[idx].fileName = fileName.trim()
        else delete cmds[idx].fileName
        fs.writeFileSync('./data/customCommands.json', JSON.stringify(cmds, null, 2))
        res.json({ success: true, message: `Command ${key} updated!` })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Custom Commands DELETE ───────────────────────────────────────────────
app.delete('/api/custom-commands/:trigger', (req, res) => {
    try {
        const key = decodeURIComponent(req.params.trigger).toLowerCase()
        let cmds = readJSON('./data/customCommands.json', [])
        const before = cmds.length
        cmds = cmds.filter(c => c.trigger !== key)
        if (cmds.length === before) return res.status(404).json({ success: false, error: 'Command not found.' })
        fs.writeFileSync('./data/customCommands.json', JSON.stringify(cmds, null, 2))
        res.json({ success: true, message: `Command ${key} deleted.` })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── Serve dashboard ──────────────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Dashboard running on port ${PORT}`)
})

module.exports = app
