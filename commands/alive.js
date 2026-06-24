const settings = require("../settings");

function renderTemplate(text = '', replacements = {}) {
    let output = String(text || '')
    for (const [key, value] of Object.entries(replacements)) {
        const pattern = new RegExp(`\\{${key}\\}`, 'gi')
        output = output.replace(pattern, String(value))
    }
    return output
}

async function aliveCommand(sock, chatId, message) {
    try {
        const modeLabel = settings.commandMode === 'private' ? 'Private' : 'Public'
        const fallbackMessage = `*🤖 Knight Bot is Active!*\n\n` +
            `*Version:* ${settings.version}\n` +
            `*Status:* Online\n` +
            `*Mode:* ${modeLabel}\n\n` +
            `*🌟 Features:*\n` +
            `• Group Management\n` +
            `• Antilink Protection\n` +
            `• Fun Commands\n` +
            `• And more!\n\n` +
            `Type *.menu* for full command list`

        const configuredMessage = String(settings.aliveMessage || '').trim()
        const message1 = configuredMessage
            ? renderTemplate(configuredMessage, {
                botName: settings.botName || 'Knight Bot',
                version: settings.version || '3.0.0',
                mode: modeLabel,
                owner: settings.botOwner || 'Owner',
            })
            : fallbackMessage

        await sock.sendMessage(chatId, {
            text: message1,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'KnightBot MD',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });
    } catch (error) {
        console.error('Error in alive command:', error);
        await sock.sendMessage(chatId, { text: 'Bot is alive and running!' }, { quoted: message });
    }
}

module.exports = aliveCommand;