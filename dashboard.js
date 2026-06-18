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

const LOG_FILE = path.join(__dirname, 'data', 'bot.log')

function addLog(level, args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (isSuppressed(msg)) return
    const entry = { time: Date.now(), level, msg }
    global.dashboardLogs.push(entry)
    if (global.dashboardLogs.length > 200) global.dashboardLogs.shift()
    // Also persist to file so background dashboard process can read it
    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n')
        // Keep file under 500 lines
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
        if (lines.length > 500) fs.writeFileSync(LOG_FILE, lines.slice(-400).join('\n') + '\n')
    } catch (_) {}
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
    const qrState = readJSON('./data/qrState.json', {})
    const connected = !!(creds && creds.me && creds.registered) || qrState.status === 'connected'
    const account = creds?.me || null
    const botInfo = readJSON('./data/botInfo.json', {})

    const totalMessages = Object.values(messageCount).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
    const warningCount = Object.keys(warnings).length

    // Session file age
    let sessionMtime = null
    try {
        const credsPath = path.join(__dirname, 'session', 'creds.json')
        if (fs.existsSync(credsPath)) sessionMtime = fs.statSync(credsPath).mtimeMs
    } catch (_) {}

    // Platform detection
    let platform = 'Local'
    if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) platform = 'Railway'
    else if (process.env.REPL_ID || process.env.REPLIT_DB_URL) platform = 'Replit'

    res.json({
        connected,
        account,
        profilePic: botInfo.profilePic || null,
        uptime: process.uptime(),
        version: settings.version || '3.0.7',
        botName: settings.botName || 'Knight Bot',
        commandMode: settings.commandMode || 'public',
        ownerNumber: settings.ownerNumber || '',
        sessionMtime,
        hasSessionEnv: !!process.env.SESSION_ID,
        platform,
        qrStatus: qrState.status || 'unknown',
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
    // Use in-memory logs if available, else read from file (background process mode)
    if (global.dashboardLogs && global.dashboardLogs.length > 0) {
        return res.json(global.dashboardLogs.slice(-100).reverse())
    }
    try {
        const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean)
        const logs = lines.slice(-100).map(l => { try { return JSON.parse(l) } catch(_) { return null } }).filter(Boolean).reverse()
        return res.json(logs)
    } catch (_) {
        return res.json([])
    }
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

// ── API: Features toggle ─────────────────────────────────────────────────────
app.post('/api/features/toggle', (req, res) => {
    const featureMap = {
        autoStatus: './data/autoStatus.json',
        autoRead:   './data/autoread.json',
        autoTyping: './data/autotyping.json',
        antiDelete: './data/antidelete.json',
    }
    const { key, enabled } = req.body
    if (!featureMap[key]) return res.status(400).json({ success: false, error: 'Unknown feature key.' })
    try {
        const current = readJSON(featureMap[key], { enabled: false })
        current.enabled = !!enabled
        fs.writeFileSync(featureMap[key], JSON.stringify(current, null, 2))
        res.json({ success: true, key, enabled: current.enabled })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
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

// ── API: Session export (base64 encode creds.json for Railway SESSION_ID) ────
app.get('/api/session/export', (req, res) => {
    try {
        const credsPath = path.join(__dirname, 'session', 'creds.json')
        if (!fs.existsSync(credsPath)) {
            return res.status(404).json({ success: false, error: 'No active session. Connect bot first.' })
        }
        const creds = fs.readFileSync(credsPath)
        const b64 = creds.toString('base64')
        res.json({ success: true, sessionId: b64 })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
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

// ── API: Analytics ─────────────────────────────────────────────────────────────
app.get('/api/analytics', (req, res) => {
    try {
        const messageCount = readJSON('./data/messageCount.json', {})
        const userGroupData = readJSON('./data/userGroupData.json', {})
        const premium = readJSON('./data/premium.json', [])
        const warnings = readJSON('./data/warnings.json', {})
        
        // Calculate top users by message count
        const topUsers = Object.entries(messageCount)
            .map(([id, count]) => ({ id, count: typeof count === 'number' ? count : 0 }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
        
        // Get group stats
        const groups = Object.entries(userGroupData)
            .filter(([id]) => id.endsWith('@g.us'))
            .map(([id, data]) => ({
                id,
                name: data.groupName || 'Unknown',
                members: data.members ? Object.keys(data.members).length : 0,
                messages: messageCount[id] || 0
            }))
            .sort((a, b) => b.messages - a.messages)
            .slice(0, 10)
        
        const premiumCount = Array.isArray(premium) ? premium.length : Object.keys(premium).length
        const totalMessages = Object.values(messageCount).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
        
        res.json({
            totalMessages,
            premiumUsers: premiumCount,
            totalWarnings: Object.keys(warnings).length,
            topUsers,
            topGroups: groups,
            stats: {
                avgMessagesPerUser: topUsers.length > 0 ? Math.round(totalMessages / topUsers.length) : 0,
                activeGroups: groups.length
            }
        })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Premium Users ──────────────────────────────────────────────────────────
app.get('/api/premium-users', (req, res) => {
    try {
        const premium = readJSON('./data/premium.json', [])
        const userData = readJSON('./data/userGroupData.json', {})
        
        const users = (Array.isArray(premium) ? premium : Object.keys(premium)).map(id => ({
            id,
            addedDate: userData[id]?.premiumDate || null,
            name: userData[id]?.name || 'Unknown'
        }))
        
        res.json(users)
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Premium Users POST (add/remove) ────────────────────────────────────────
app.post('/api/premium-users', (req, res) => {
    try {
        const { action, userId } = req.body
        if (!action || !userId) return res.status(400).json({ success: false, error: 'Action and userId required.' })
        
        let premium = readJSON('./data/premium.json', [])
        let userData = readJSON('./data/userGroupData.json', {})
        
        if (action === 'add') {
            if (!Array.isArray(premium)) premium = Object.keys(premium)
            if (!premium.includes(userId)) {
                premium.push(userId)
                userData[userId] = { ...userData[userId], premiumDate: new Date().toISOString() }
            } else {
                return res.status(409).json({ success: false, error: 'User already premium.' })
            }
        } else if (action === 'remove') {
            if (Array.isArray(premium)) {
                premium = premium.filter(id => id !== userId)
            } else {
                delete premium[userId]
            }
        } else {
            return res.status(400).json({ success: false, error: 'Invalid action.' })
        }
        
        fs.writeFileSync('./data/premium.json', JSON.stringify(premium, null, 2))
        fs.writeFileSync('./data/userGroupData.json', JSON.stringify(userData, null, 2))
        res.json({ success: true, message: `User ${action === 'add' ? 'added to' : 'removed from'} premium.` })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Groups Info ────────────────────────────────────────────────────────────
app.get('/api/groups', (req, res) => {
    try {
        const userGroupData = readJSON('./data/userGroupData.json', {})
        const messageCount = readJSON('./data/messageCount.json', {})
        
        const groups = Object.entries(userGroupData)
            .filter(([id]) => id.endsWith('@g.us'))
            .map(([id, data]) => ({
                id,
                name: data.groupName || 'Unknown',
                members: data.members ? Object.keys(data.members).length : 0,
                messages: messageCount[id] || 0,
                admin: data.admin || false,
                joinedDate: data.joinDate || null
            }))
            .sort((a, b) => b.messages - a.messages)
        
        res.json(groups)
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Advanced Settings GET ──────────────────────────────────────────────────
app.get('/api/advanced-settings', (req, res) => {
    try {
        const settings = require('./settings')
        res.json({
            prefix: settings.prefix || '.',
            autoTyping: settings.autoTyping !== false,
            autoRead: settings.autoRead !== false,
            antiDelete: settings.antiDelete !== false,
            autoStatus: settings.autoStatus !== false,
            logChat: settings.logChat !== false,
            alwaysOnline: settings.alwaysOnline || false,
            readReceipts: settings.readReceipts !== false,
            botLanguage: settings.botLanguage || 'en'
        })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── API: Advanced Settings POST ────────────────────────────────────────────────
app.post('/api/advanced-settings', (req, res) => {
    try {
        const { key, value } = req.body
        if (!key) return res.status(400).json({ success: false, error: 'Key required.' })
        
        const settingsPath = path.join(__dirname, 'settings.js')
        let content = fs.readFileSync(settingsPath, 'utf8')
        
        // Simple key-value replacement for boolean/string settings
        const valueStr = typeof value === 'boolean' ? String(value) : `'${String(value).replace(/'/g, "\\'")}'`
        content = content.replace(
            new RegExp(`(${key}\\s*:\\s*)([^,}]+)`, 'g'),
            `$1${valueStr}`
        )
        
        fs.writeFileSync(settingsPath, content, 'utf8')
        delete require.cache[require.resolve('./settings')]
        
        res.json({ success: true, message: `Setting updated! Restart bot for effect.` })
    } catch (err) {
        res.status(500).json({ success: false, error: err.message })
    }
})

// ── Serve dashboard ──────────────────────────────────────────────────────────
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Dashboard running on port ${PORT}`)
})
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        originalLog(`🌐 Dashboard port ${PORT} already in use — skipping bind`)
    } else {
        throw err
    }
})

module.exports = app
