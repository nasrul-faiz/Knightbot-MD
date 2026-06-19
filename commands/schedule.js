const {
    listSchedules,
    addDailySchedule,
    addOnceSchedule,
    deleteSchedule,
    clearSchedules,
    formatDateTime
} = require('../lib/scheduler');

function buildHelpText() {
    return [
        '⏰ *Schedule Command*',
        '',
        '• `.schedule daily HH:MM | mesej`',
        '• `.schedule once YYYY-MM-DD HH:MM | mesej`',
        '• `.schedule list`',
        '• `.schedule delete <id>`',
        '• `.schedule clear`',
        '',
        'Contoh:',
        '`.schedule daily 08:30 | Selamat pagi semua`',
        '`.schedule once 2026-06-21 21:00 | Meeting malam ini`'
    ].join('\n');
}

async function scheduleCommand(sock, chatId, message, rawText, senderId) {
    const parts = rawText.trim().split(/\s+/);
    const sub = (parts[1] || '').toLowerCase();

    if (!sub) {
        await sock.sendMessage(chatId, { text: buildHelpText() }, { quoted: message });
        return;
    }

    if (sub === 'list') {
        const schedules = listSchedules(chatId);
        if (!schedules.length) {
            await sock.sendMessage(chatId, { text: 'Tiada scheduled chat untuk ruangan ini.' }, { quoted: message });
            return;
        }

        const lines = ['📋 *Scheduled Chat List*', ''];
        for (const item of schedules) {
            const typeLabel = item.type === 'daily' ? 'daily' : 'once';
            const preview = item.message.length > 60 ? `${item.message.slice(0, 57)}...` : item.message;
            lines.push(`#${item.id} [${typeLabel}] ${formatDateTime(item.nextRunAt)}`);
            lines.push(`Pesan: ${preview}`);
            lines.push('');
        }

        await sock.sendMessage(chatId, { text: lines.join('\n').trim() }, { quoted: message });
        return;
    }

    if (sub === 'delete' || sub === 'del' || sub === 'remove') {
        const idArg = parts[2];
        if (!idArg) {
            await sock.sendMessage(chatId, { text: 'Guna: `.schedule delete <id>`' }, { quoted: message });
            return;
        }

        const result = deleteSchedule(chatId, idArg);
        if (!result.ok) {
            await sock.sendMessage(chatId, { text: `❌ ${result.error}` }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { text: `✅ Jadual #${result.removed.id} berjaya dipadam.` }, { quoted: message });
        return;
    }

    if (sub === 'clear') {
        const result = clearSchedules(chatId);
        if (!result.ok) {
            await sock.sendMessage(chatId, { text: `❌ ${result.error}` }, { quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { text: `✅ ${result.removedCount} jadual dipadam untuk chat ini.` }, { quoted: message });
        return;
    }

    if (sub === 'daily') {
        const payload = rawText.slice(rawText.toLowerCase().indexOf('daily') + 5).trim();
        const [left, ...rest] = payload.split('|');
        const msgText = rest.join('|').trim();
        const time = (left || '').trim();

        if (!time || !msgText) {
            await sock.sendMessage(chatId, {
                text: 'Guna: `.schedule daily HH:MM | mesej`\nContoh: `.schedule daily 08:30 | Selamat pagi`'
            }, { quoted: message });
            return;
        }

        const result = addDailySchedule(chatId, msgText, time, senderId);
        if (!result.ok) {
            await sock.sendMessage(chatId, { text: `❌ ${result.error}` }, { quoted: message });
            return;
        }

        const item = result.schedule;
        await sock.sendMessage(chatId, {
            text: `✅ Jadual harian berjaya ditambah.\nID: #${item.id}\nSetiap hari: ${item.time}\nRun seterusnya: ${formatDateTime(item.nextRunAt)}`
        }, { quoted: message });
        return;
    }

    if (sub === 'once') {
        const payload = rawText.slice(rawText.toLowerCase().indexOf('once') + 4).trim();
        const [left, ...rest] = payload.split('|');
        const msgText = rest.join('|').trim();
        const timeParts = (left || '').trim().split(/\s+/);

        if (timeParts.length < 2 || !msgText) {
            await sock.sendMessage(chatId, {
                text: 'Guna: `.schedule once YYYY-MM-DD HH:MM | mesej`\nContoh: `.schedule once 2026-06-21 21:00 | Meeting malam ini`'
            }, { quoted: message });
            return;
        }

        const date = timeParts[0];
        const time = timeParts[1];
        const result = addOnceSchedule(chatId, msgText, date, time, senderId);

        if (!result.ok) {
            await sock.sendMessage(chatId, { text: `❌ ${result.error}` }, { quoted: message });
            return;
        }

        const item = result.schedule;
        await sock.sendMessage(chatId, {
            text: `✅ Jadual sekali berjaya ditambah.\nID: #${item.id}\nTarikh: ${item.date} ${item.time}\nRun: ${formatDateTime(item.nextRunAt)}`
        }, { quoted: message });
        return;
    }

    await sock.sendMessage(chatId, { text: buildHelpText() }, { quoted: message });
}

module.exports = scheduleCommand;
